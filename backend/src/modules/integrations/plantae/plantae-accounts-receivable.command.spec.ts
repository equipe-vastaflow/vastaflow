import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import { CommandCatalog } from '../../commands/command-catalog';
import { CommandOutcome, type CommandContext } from '../../commands/command.types';
import { HelpCommandHandler } from '../../commands/handlers/help.command';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { RoleName } from '../../roles/role-name.enum';
import {
  AccountsPayableCommandHandler,
  AccountsReceivableCommandHandler,
  CHAT_PAGE_SIZE,
  CHAT_QUERIES_PER_MINUTE,
  CONTAS_PAGAR_MESSAGES,
  CONTAS_RECEBER_MESSAGES,
  CONTAS_RECEBER_USAGE,
  createPlantaeChatLimiter,
  HOMOLOGATION_BANNER,
  PRODUCTION_BANNER,
} from './plantae-accounts-payable.command';
import { PlantaeApiError, type PlantaeFailure } from './plantae-errors';
import type { PlantaeService } from './plantae.service';
import type { PlantaeEntry, PlantaePage } from './plantae.types';

/*
 * `/contas_receber` e o MESMO handler de `/contas_pagar` com outra especificacao. Estes
 * testes provam o que muda (tipo `receita`, textos, nome do cliente NUNCA aparece) e o
 * que precisa continuar igual (portoes, periodo, limite, falhas, auditoria). Os testes
 * de `/contas_pagar` ficam em `plantae-accounts-payable.command.spec.ts`, intactos.
 */

// 2026-10-13 15:00 UTC = 12:00 em Brasilia.
const AGORA = new Date('2026-10-13T15:00:00Z');

function config(values: Record<string, unknown>): { get: <T>(k: string) => T | undefined } {
  return { get: <T>(key: string): T | undefined => values[key] as T };
}

const LIGADO = {
  PLANTAE_CHAT_COMMANDS_ENABLED: true,
  PLANTAE_ENABLED: true,
  PLANTAE_ORGANIZATION_CONFIRMED: true,
  PLANTAE_BASE_URL: 'https://rc.plantae.agr.br/api/v1/external',
};

function contexto(text = '/contas_receber', userId = 'user-1'): CommandContext {
  return {
    user: { id: userId } as unknown as CommandContext['user'],
    conversationId: '555',
    channel: 'telegram' as CommandContext['channel'],
    text,
  };
}

function entrada(over: Partial<PlantaeEntry> = {}): PlantaeEntry {
  return {
    parcela_id: 77,
    numero: 1,
    total_parcelas: 3,
    data_vencto: '2026-10-15',
    valor: '4200.5',
    total_pago: null,
    total_juros: null,
    total_multa: null,
    total_desconto: null,
    total_abatido: null,
    saldo_atual: '4200.50',
    data_ult_pagto: null,
    status: { codigo: 0, descricao: 'Pendente' },
    titulo: {
      titulo_id: 9,
      tipo: null,
      origem: null,
      num_documento: 'DOC-SIGILOSO-1',
      data_emissao: null,
      valor_total: '12601.50',
      moeda: { moeda_id: 1, nome: 'Real', simbolo: 'R$' },
      descricao: 'DESCRICAO-SIGILOSA',
      observacao: 'OBSERVACAO-SIGILOSA',
    },
    pessoa: {
      pessoa_id: 3,
      nome: 'Cliente Ficticio',
      razao_social: 'Cliente Ficticio LTDA',
      tipo_pessoa: 'J',
      cpf_cnpj: '12.345.678/0001-90',
    },
    razao_social: null,
    rateio: [],
    ...over,
  };
}

function pagina(items: PlantaeEntry[], hasMore: boolean | null = false): PlantaePage<PlantaeEntry> {
  return { items, pagination: { perPage: 5, nextCursor: null, hasMore, pagesFetched: 1 } };
}

function montar(
  values: Record<string, unknown> = LIGADO,
  resposta: () => Promise<PlantaePage<PlantaeEntry>> = () => Promise.resolve(pagina([entrada()])),
): { handler: AccountsReceivableCommandHandler; listEntries: jest.Mock } {
  const listEntries = jest.fn().mockImplementation(resposta);
  const handler = new AccountsReceivableCommandHandler(
    { listEntries } as unknown as PlantaeService,
    config(values),
    () => AGORA,
  );
  return { handler, listEntries };
}

describe('AccountsReceivableCommandHandler (/contas_receber)', () => {
  it('contrato com o Command Engine: nome, mesma permissao e mesma auditoria do /contas_pagar', () => {
    const { handler } = montar();

    expect(handler.name).toBe('contas_receber');
    expect(handler.permission).toBe(PermissionCode.PlantaeRead);
    expect(handler.audit).toEqual({
      acao: AuditAction.PlantaeQueried,
      modulo: AuditModuleName.Plantae,
    });
    expect(handler.description).toBe('Contas a receber pendentes no Plantae (somente consulta)');
    expect(handler.description).not.toMatch(/homologacao|producao/i);
  });

  describe('mesmos portoes do /contas_pagar: desligado, nada e consultado', () => {
    it.each([
      [
        'comando de chat desligado',
        { ...LIGADO, PLANTAE_CHAT_COMMANDS_ENABLED: false },
        CONTAS_RECEBER_MESSAGES.chatDisabled,
      ],
      [
        'organizacao nao confirmada',
        { ...LIGADO, PLANTAE_ORGANIZATION_CONFIRMED: false },
        CONTAS_RECEBER_MESSAGES.organizationNotConfirmed,
      ],
      [
        'integracao desligada',
        { ...LIGADO, PLANTAE_ENABLED: false },
        CONTAS_RECEBER_MESSAGES.integrationDisabled,
      ],
    ])('%s', async (_caso, valores, mensagem) => {
      const { handler, listEntries } = montar(valores);

      const r = await handler.handle(contexto());

      expect(r).toMatchObject({ success: false, reply: mensagem });
      expect(listEntries).not.toHaveBeenCalled();
    });

    it('a mensagem de desligado fala de contas a RECEBER', () => {
      expect(CONTAS_RECEBER_MESSAGES.chatDisabled).toContain('contas a receber');
      expect(CONTAS_RECEBER_MESSAGES.chatDisabled).not.toBe(CONTAS_PAGAR_MESSAGES.chatDisabled);
    });
  });

  describe('consulta', () => {
    it('sem argumentos: receitas PENDENTES de hoje (Brasilia) ate hoje + 7, ate 5 itens', async () => {
      const { handler, listEntries } = montar();

      await handler.handle(contexto());

      expect(listEntries).toHaveBeenCalledWith({
        tipo: 'receita',
        status: [0],
        dataInicio: '2026-10-13',
        dataFim: '2026-10-20',
        perPage: CHAT_PAGE_SIZE,
      });
    });

    it('com duas datas: o mesmo limite de 31 dias do /contas_pagar', async () => {
      const { handler, listEntries } = montar();

      await handler.handle(contexto('/contas_receber 2026-11-01 2026-12-01'));
      const recusado = await handler.handle(contexto('/contas_receber 2026-11-01 2026-12-02'));

      expect(listEntries).toHaveBeenCalledTimes(1);
      expect(listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tipo: 'receita',
          dataInicio: '2026-11-01',
          dataFim: '2026-12-01',
        }),
      );
      expect(recusado).toMatchObject({
        success: false,
        outcome: CommandOutcome.MalformedCommand,
        reply: CONTAS_RECEBER_USAGE,
      });
    });

    it.each([
      '/contas_receber 2026-13-45 abc',
      '/contas_receber 2026-10-01',
      '/contas_receber x y z',
    ])('argumentos invalidos (%s): uso de /contas_receber, sem consultar', async (texto) => {
      const { handler, listEntries } = montar();

      const r = await handler.handle(contexto(texto));

      expect(r.reply).toBe(CONTAS_RECEBER_USAGE);
      expect(listEntries).not.toHaveBeenCalled();
    });
  });

  describe('resposta', () => {
    it('aviso de ambiente, titulo, vencimento, valor na moeda, parcela e referencia', async () => {
      const { handler } = montar();

      const r = await handler.handle(contexto());
      const linhas = r.reply.split('\n');

      expect(r.success).toBe(true);
      expect(linhas[0]).toBe(HOMOLOGATION_BANNER);
      expect(linhas[1]).toBe('Contas a receber pendentes (Plantae)');
      expect(linhas[2]).toBe('Vencimento: 13/10/2026 a 20/10/2026');
      expect(linhas[3]).toBe('1) 15/10/2026 - R$ 4.200,50 (parcela 1/3) - ref 77');
      expect(r.reply).not.toContain('Contas a pagar');
    });

    it('em producao, o aviso de dados reais e somente consulta', async () => {
      const { handler } = montar({
        ...LIGADO,
        PLANTAE_BASE_URL: 'https://web.plantae.agr.br/api/v1/external',
      });

      const r = await handler.handle(contexto());

      expect(r.reply.split('\n')[0]).toBe(PRODUCTION_BANNER);
    });

    it('NUNCA mostra o nome do cliente, nem com PLANTAE_CHAT_SHOW_PAYEE_NAME ligado', async () => {
      const { handler } = montar({ ...LIGADO, PLANTAE_CHAT_SHOW_PAYEE_NAME: true });

      const r = await handler.handle(contexto());

      expect(r.reply).not.toContain('Cliente Ficticio');
      expect(r.reply).not.toContain('LTDA');
    });

    it('nunca CPF/CNPJ, documento, descricao, observacao, valor total nem ids da pessoa/titulo', async () => {
      const { handler } = montar({ ...LIGADO, PLANTAE_CHAT_SHOW_PAYEE_NAME: true });

      const r = await handler.handle(contexto());

      for (const proibido of [
        '12.345.678/0001-90',
        '12345678000190',
        'DOC-SIGILOSO',
        'DESCRICAO-SIGILOSA',
        'OBSERVACAO-SIGILOSA',
        '12.601,50',
        'pessoa',
        'titulo',
      ]) {
        expect(r.reply).not.toContain(proibido);
      }
    });

    it('recebimento parcial e SINALIZADO (sem calcular saldo)', async () => {
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(pagina([entrada({ total_pago: '100.00' })])),
      );

      const r = await handler.handle(contexto());

      expect(r.reply).toContain('JA TEVE RECEBIMENTO PARCIAL (confira no Plantae)');
      expect(r.reply).not.toContain('PAGAMENTO PARCIAL');
    });

    it('so pendentes e no maximo 5, mesmo que o Plantae devolva outra coisa', async () => {
      const itens = [
        entrada({ parcela_id: 1, status: { codigo: 1, descricao: 'Quitada' } }),
        entrada({ parcela_id: 2, status: { codigo: 2, descricao: 'Substituida' } }),
        ...Array.from({ length: 7 }, (_, i) => entrada({ parcela_id: 100 + i })),
      ];
      const { handler } = montar(LIGADO, () => Promise.resolve(pagina(itens)));

      const r = await handler.handle(contexto());

      expect(r.reply).not.toMatch(/ref 1\b|ref 2\b/);
      expect(r.reply.match(/^\d\) /gm)).toHaveLength(CHAT_PAGE_SIZE);
      expect(r.reply).toContain('Ha mais resultados');
      expect(r.reply).toContain('2 item(ns) fora do status pendente foram ignorados');
    });

    it('sem resultados: mensagem de contas a receber', async () => {
      const { handler } = montar(LIGADO, () => Promise.resolve(pagina([])));

      const r = await handler.handle(contexto());

      expect(r.reply).toContain(CONTAS_RECEBER_MESSAGES.empty);
      expect(r.auditDetail).toBe('vazio');
    });
  });

  describe('falhas do Plantae viram frase fixa', () => {
    it.each<[PlantaeFailure, string, string]>([
      ['unauthorized', CONTAS_RECEBER_MESSAGES.credentialRefused, 'credencial_recusada'],
      ['rate-limited', CONTAS_RECEBER_MESSAGES.rateLimited, 'limite_fornecedor'],
      ['rejected-parameters', CONTAS_RECEBER_MESSAGES.rejected, 'parametros_rejeitados'],
      ['server-error', CONTAS_RECEBER_MESSAGES.unavailable, 'erro_fornecedor'],
    ])('%s', async (kind, mensagem, detalhe) => {
      const { handler } = montar(LIGADO, () =>
        Promise.reject(new PlantaeApiError(kind, { where: 'CPF 123.456.789-09' })),
      );

      const r = await handler.handle(contexto());

      expect(r).toMatchObject({ success: false, reply: mensagem, auditDetail: detalhe });
      expect(r.reply).not.toContain('123.456.789-09');
    });
  });
});

describe('limite por pessoa COMPARTILHADO entre /contas_pagar e /contas_receber', () => {
  function par(): {
    pagar: AccountsPayableCommandHandler;
    receber: AccountsReceivableCommandHandler;
    listEntries: jest.Mock;
  } {
    const listEntries = jest.fn().mockResolvedValue(pagina([entrada()]));
    const service = { listEntries } as unknown as PlantaeService;
    const limiter = createPlantaeChatLimiter();
    return {
      pagar: new AccountsPayableCommandHandler(service, config(LIGADO), () => AGORA, limiter),
      receber: new AccountsReceivableCommandHandler(service, config(LIGADO), () => AGORA, limiter),
      listEntries,
    };
  }

  it(`${String(CHAT_QUERIES_PER_MINUTE)} consultas por minuto NO TOTAL: alternar comandos nao dobra a cota`, async () => {
    const { pagar, receber, listEntries } = par();

    await pagar.handle(contexto('/contas_pagar'));
    await receber.handle(contexto());
    await pagar.handle(contexto('/contas_pagar'));
    const quarta = await receber.handle(contexto());

    expect(quarta).toMatchObject({
      success: false,
      reply: CONTAS_RECEBER_MESSAGES.throttled,
      auditDetail: 'limite_pessoa',
    });
    expect(listEntries).toHaveBeenCalledTimes(CHAT_QUERIES_PER_MINUTE);
  });

  it('a cota e por pessoa: outra pessoa continua consultando', async () => {
    const { pagar, receber, listEntries } = par();
    for (let i = 0; i < CHAT_QUERIES_PER_MINUTE; i += 1) {
      await pagar.handle(contexto('/contas_pagar', 'pessoa-a'));
    }

    const outra = await receber.handle(contexto('/contas_receber', 'pessoa-b'));

    expect(outra.success).toBe(true);
    expect(listEntries).toHaveBeenCalledTimes(CHAT_QUERIES_PER_MINUTE + 1);
  });

  it('/contas_pagar continua pedindo despesas e mostrando o favorecido so com a politica', async () => {
    const { pagar, listEntries } = par();
    const comPolitica = new AccountsPayableCommandHandler(
      { listEntries } as unknown as PlantaeService,
      config({ ...LIGADO, PLANTAE_CHAT_SHOW_PAYEE_NAME: true }),
      () => AGORA,
    );

    const padrao = await pagar.handle(contexto('/contas_pagar'));
    const ligado = await comPolitica.handle(contexto('/contas_pagar'));

    expect(listEntries).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'despesa' }));
    expect(padrao.reply.split('\n')[1]).toBe('Contas a pagar pendentes (Plantae)');
    expect(padrao.reply).not.toContain('Cliente Ficticio');
    expect(ligado.reply).toContain('Cliente Ficticio');
  });
});

describe('/ajuda lista os dois comandos so para quem tem plantae:read', () => {
  function ajudaPara(role: RoleName, permissions: string[]): string {
    const catalog = new CommandCatalog();
    const service = { listEntries: jest.fn() } as unknown as PlantaeService;
    catalog.register([
      new AccountsPayableCommandHandler(service, config(LIGADO)),
      new AccountsReceivableCommandHandler(service, config(LIGADO)),
    ]);
    const help = new HelpCommandHandler(catalog);
    return help.handle({
      ...contexto('/ajuda'),
      user: { id: 'u', role, permissions } as unknown as CommandContext['user'],
    }).reply;
  }

  it('GESTOR com plantae:read ve /contas_pagar e /contas_receber', () => {
    const texto = ajudaPara(RoleName.Gestor, [PermissionCode.PlantaeRead]);

    expect(texto).toContain('/contas_pagar - Contas a pagar pendentes no Plantae');
    expect(texto).toContain('/contas_receber - Contas a receber pendentes no Plantae');
  });

  it('sem plantae:read, nenhum dos dois aparece', () => {
    const texto = ajudaPara(RoleName.Operador, []);

    expect(texto).not.toContain('/contas_pagar');
    expect(texto).not.toContain('/contas_receber');
  });
});
