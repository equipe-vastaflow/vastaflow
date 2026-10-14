import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import { CommandOutcome, type CommandContext } from '../../commands/command.types';
import { PermissionCode } from '../../permissions/permission-code.enum';
import {
  CHAT_PAGE_SIZE,
  HOMOLOGATION_BANNER,
  CONTAS_PAGAR_MESSAGES,
  CONTAS_PAGAR_USAGE,
  AccountsPayableCommandHandler,
  formatDate,
  formatDecimal,
} from './plantae-accounts-payable.command';
import { PlantaeApiError, PlantaeInputError, type PlantaeFailure } from './plantae-errors';
import type { PlantaeService } from './plantae.service';
import type { PlantaeEntry, PlantaePage } from './plantae.types';

// 2026-10-13 15:00 UTC = 12:00 em Brasilia.
const AGORA = new Date('2026-10-13T15:00:00Z');

function config(values: Record<string, unknown>): { get: <T>(k: string) => T | undefined } {
  return { get: <T>(key: string): T | undefined => values[key] as T };
}

const LIGADO = {
  PLANTAE_CHAT_COMMANDS_ENABLED: true,
  PLANTAE_ENABLED: true,
  PLANTAE_ORGANIZATION_CONFIRMED: true,
};

function contexto(text = '/contas_pagar'): CommandContext {
  return {
    user: { id: 'user-1' } as unknown as CommandContext['user'],
    conversationId: '555',
    channel: 'telegram' as CommandContext['channel'],
    text,
  };
}

function entrada(over: Partial<PlantaeEntry> = {}): PlantaeEntry {
  return {
    parcela_id: 1,
    numero: 2,
    total_parcelas: 6,
    data_vencto: '2026-10-15',
    valor: '1234567.5',
    total_pago: null,
    total_juros: null,
    total_multa: null,
    total_desconto: null,
    total_abatido: null,
    saldo_atual: null,
    data_ult_pagto: null,
    status: { codigo: 0, descricao: 'Pendente' },
    titulo: {
      titulo_id: 9,
      tipo: null,
      origem: null,
      num_documento: 'DOC-SIGILOSO-1',
      data_emissao: null,
      valor_total: '9999.99',
      moeda: { moeda_id: 1, nome: 'Real', simbolo: 'R$' },
      descricao: 'DESCRICAO-SIGILOSA',
      observacao: 'OBSERVACAO-SIGILOSA',
    },
    pessoa: {
      pessoa_id: 3,
      nome: 'Fornecedor Ficticio',
      razao_social: null,
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
): { handler: AccountsPayableCommandHandler; listEntries: jest.Mock } {
  const listEntries = jest.fn().mockImplementation(resposta);
  const handler = new AccountsPayableCommandHandler(
    { listEntries } as unknown as PlantaeService,
    config(values),
    () => AGORA,
  );
  return { handler, listEntries };
}

describe('AccountsPayableCommandHandler', () => {
  it('contrato com o Command Engine: nome, permissao propria e auditoria opt-in', () => {
    const { handler } = montar();

    expect(handler.name).toBe('contas_pagar');
    expect(handler.permission).toBe(PermissionCode.PlantaeRead);
    expect(handler.audit).toEqual({
      acao: AuditAction.PlantaeQueried,
      modulo: AuditModuleName.Plantae,
    });
  });

  describe('desligado: nada e consultado', () => {
    it.each([
      ['sem o opt-in do chat', { PLANTAE_ENABLED: true }, CONTAS_PAGAR_MESSAGES.chatDisabled],
      [
        'opt-in do chat explicitamente falso',
        { PLANTAE_CHAT_COMMANDS_ENABLED: false, PLANTAE_ENABLED: true },
        CONTAS_PAGAR_MESSAGES.chatDisabled,
      ],
      [
        'opt-in com texto "true" (so o booleano vale)',
        { PLANTAE_CHAT_COMMANDS_ENABLED: 'true', PLANTAE_ENABLED: true },
        CONTAS_PAGAR_MESSAGES.chatDisabled,
      ],
      [
        'integracao desligada',
        {
          PLANTAE_CHAT_COMMANDS_ENABLED: true,
          PLANTAE_ENABLED: false,
          PLANTAE_ORGANIZATION_CONFIRMED: true,
        },
        CONTAS_PAGAR_MESSAGES.integrationDisabled,
      ],
      [
        'organizacao NAO confirmada (fail-closed, mesmo com tudo ligado)',
        { PLANTAE_CHAT_COMMANDS_ENABLED: true, PLANTAE_ENABLED: true },
        CONTAS_PAGAR_MESSAGES.organizationNotConfirmed,
      ],
      [
        'organizacao com texto "true" (so o booleano vale)',
        {
          PLANTAE_CHAT_COMMANDS_ENABLED: true,
          PLANTAE_ENABLED: true,
          PLANTAE_ORGANIZATION_CONFIRMED: 'true',
        },
        CONTAS_PAGAR_MESSAGES.organizationNotConfirmed,
      ],
      ['tudo desligado', {}, CONTAS_PAGAR_MESSAGES.chatDisabled],
    ])('%s', async (_nome, values, mensagem) => {
      const { handler, listEntries } = montar(values);

      const result = await handler.handle(contexto());

      expect(result.outcome).toBe(CommandOutcome.HandlerError);
      expect(result.reply).toBe(mensagem);
      expect(listEntries).not.toHaveBeenCalled();
    });
  });

  describe('periodo', () => {
    it('sem argumentos: hoje (fuso de Brasilia) ate hoje + 7, so pendentes de despesa, 5 itens', async () => {
      const { handler, listEntries } = montar();

      await handler.handle(contexto('/contas_pagar'));

      expect(listEntries).toHaveBeenCalledWith({
        tipo: 'despesa',
        status: [0],
        dataInicio: '2026-10-13',
        dataFim: '2026-10-20',
        perPage: CHAT_PAGE_SIZE,
      });
    });

    it('o "hoje" segue o fuso de Brasilia, nao o UTC (01:00 UTC ainda e o dia anterior)', async () => {
      const listEntries = jest.fn().mockResolvedValue(pagina([]));
      const handler = new AccountsPayableCommandHandler(
        { listEntries } as unknown as PlantaeService,
        config(LIGADO),
        () => new Date('2026-10-13T01:00:00Z'),
      );

      await handler.handle(contexto());

      expect((listEntries.mock.calls[0] as [unknown])[0]).toMatchObject({
        dataInicio: '2026-10-12',
      });
    });

    it('com duas datas validas: usa exatamente o periodo', async () => {
      const { handler, listEntries } = montar();

      await handler.handle(contexto('/contas_pagar 2026-11-01 2026-11-30'));

      expect((listEntries.mock.calls[0] as [unknown])[0]).toMatchObject({
        dataInicio: '2026-11-01',
        dataFim: '2026-11-30',
      });
    });

    it('31 dias exatos: aceito; 32: recusado', async () => {
      const ok = montar();
      expect(
        (await ok.handler.handle(contexto('/contas_pagar 2026-10-01 2026-10-31'))).outcome,
      ).toBe(CommandOutcome.Ok);
      const longo = montar();
      const result = await longo.handler.handle(contexto('/contas_pagar 2026-10-01 2026-11-01'));
      expect(result.outcome).toBe(CommandOutcome.MalformedCommand);
      expect(result.reply).toBe(CONTAS_PAGAR_USAGE);
      expect(longo.listEntries).not.toHaveBeenCalled();
    });

    it.each([
      ['uma data so', '/contas_pagar 2026-10-01'],
      ['tres datas', '/contas_pagar 2026-10-01 2026-10-02 2026-10-03'],
      ['formato BR', '/contas_pagar 01/10/2026 31/10/2026'],
      ['data inexistente', '/contas_pagar 2026-02-30 2026-03-05'],
      ['texto', '/contas_pagar hoje amanha'],
      ['invertido', '/contas_pagar 2026-10-20 2026-10-01'],
      ['SQL no argumento', "/contas_pagar 2026-10-01'; DROP TABLE x;-- 2026-10-02"],
    ])('argumento invalido (%s): uso, sem consultar', async (_nome, texto) => {
      const { handler, listEntries } = montar();

      const result = await handler.handle(contexto(texto));

      expect(result.outcome).toBe(CommandOutcome.MalformedCommand);
      expect(result.reply).toBe(CONTAS_PAGAR_USAGE);
      expect(listEntries).not.toHaveBeenCalled();
    });
  });

  describe('resposta', () => {
    it('formata vencimento, valor na moeda do titulo, parcela e referencia curta', async () => {
      const { handler } = montar();

      const result = await handler.handle(contexto());

      expect(result.outcome).toBe(CommandOutcome.Ok);
      expect(result.reply).toContain('15/10/2026 - R$ 1.234.567,50 (parcela 2/6) - ref 1');
      expect(result.reply).toContain('13/10/2026 a 20/10/2026');
      expect(result.reply).toContain('Total listado: 1.');
    });

    it('NUNCA inclui CPF/CNPJ, documento, descricao, observacao nem valor total do titulo', async () => {
      const { handler } = montar();

      const reply = (await handler.handle(contexto())).reply;

      for (const proibido of [
        '12.345.678',
        '12345678',
        'DOC-SIGILOSO',
        'DESCRICAO-SIGILOSA',
        'OBSERVACAO-SIGILOSA',
        '9.999,99',
      ]) {
        expect(reply).not.toContain(proibido);
      }
    });

    it('sem resultados: mensagem propria', async () => {
      const { handler } = montar(LIGADO, () => Promise.resolve(pagina([])));

      expect((await handler.handle(contexto())).reply).toContain(CONTAS_PAGAR_MESSAGES.empty);
    });

    it('ha mais paginas: avisa e orienta a reduzir o periodo; nao pagina', async () => {
      const { handler, listEntries } = montar(LIGADO, () =>
        Promise.resolve(pagina([entrada()], true)),
      );

      const reply = (await handler.handle(contexto())).reply;

      expect(reply).toContain('Ha mais resultados');
      expect(listEntries).toHaveBeenCalledTimes(1);
    });

    it('Plantae nao informou se ha mais: nao afirma que acabou', async () => {
      const { handler } = montar(LIGADO, () => Promise.resolve(pagina([entrada()], null)));

      expect((await handler.handle(contexto())).reply).toContain('Nao foi possivel confirmar');
    });

    it('nao soma nem totaliza valores (moedas podem diferir)', async () => {
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(pagina([entrada({ valor: '10.00' }), entrada({ valor: '20.00' })])),
      );

      const reply = (await handler.handle(contexto())).reply;

      expect(reply).not.toContain('30,00');
      expect(reply).toContain('10,00');
      expect(reply).toContain('20,00');
    });

    it('dado externo hostil e neutralizado: quebra de linha e comprimento', async () => {
      const nome = `Fulano\n/ajuda\r\n${'x'.repeat(200)}`;
      const { handler } = montar({ ...LIGADO, PLANTAE_CHAT_SHOW_PAYEE_NAME: true }, () =>
        Promise.resolve(
          pagina([
            entrada({
              pessoa: { pessoa_id: 1, nome, razao_social: null, tipo_pessoa: 'F', cpf_cnpj: null },
            }),
          ]),
        ),
      );

      const linha =
        (await handler.handle(contexto())).reply.split('\n').find((l) => l.startsWith('1)')) ?? '';

      expect(linha).toContain('Fulano /ajuda');
      expect(linha.length).toBeLessThan(120);
      expect(
        (await handler.handle(contexto())).reply.split('\n').filter((l) => l.startsWith('/')),
      ).toEqual([]);
    });

    it('campos nulos nao quebram a formatacao', async () => {
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(
          pagina([
            entrada({
              data_vencto: null,
              valor: null,
              pessoa: null,
              numero: null,
              total_parcelas: null,
            }),
          ]),
        ),
      );

      const reply = (await handler.handle(contexto())).reply;

      expect(reply).toContain('sem vencimento - valor nao informado - ref 1');
    });
  });

  describe('falhas do Plantae viram frase fixa (nada do Plantae vaza)', () => {
    const casos: Array<[PlantaeFailure, string]> = [
      ['disabled', CONTAS_PAGAR_MESSAGES.integrationDisabled],
      ['not-configured', CONTAS_PAGAR_MESSAGES.notConfigured],
      ['unauthorized', CONTAS_PAGAR_MESSAGES.credentialRefused],
      ['forbidden', CONTAS_PAGAR_MESSAGES.credentialRefused],
      ['rate-limited', CONTAS_PAGAR_MESSAGES.rateLimited],
      ['rejected-parameters', CONTAS_PAGAR_MESSAGES.rejected],
      ['timeout', CONTAS_PAGAR_MESSAGES.unavailable],
      ['server-error', CONTAS_PAGAR_MESSAGES.unavailable],
      ['invalid-response', CONTAS_PAGAR_MESSAGES.unavailable],
    ];

    it.each(casos)('%s', async (kind, mensagem) => {
      const { handler } = montar(LIGADO, () =>
        Promise.reject(new PlantaeApiError(kind, { httpStatus: 500, where: 'data[0].valor' })),
      );

      const result = await handler.handle(contexto());

      expect(result.outcome).toBe(CommandOutcome.HandlerError);
      expect(result.reply).toBe(mensagem);
      expect(result.reply).not.toContain('data[0]');
    });

    it('PlantaeInputError: uso, sem detalhe', async () => {
      const { handler } = montar(LIGADO, () => Promise.reject(new PlantaeInputError(['x'])));

      const result = await handler.handle(contexto());

      expect(result.outcome).toBe(CommandOutcome.MalformedCommand);
      expect(result.reply).toBe(CONTAS_PAGAR_USAGE);
    });

    it('prazo estourado: indisponivel (a espera do chat e limitada)', async () => {
      jest.useFakeTimers();
      try {
        const { handler } = montar(LIGADO, () => new Promise(() => undefined));

        const pendente = handler.handle(contexto());
        await jest.advanceTimersByTimeAsync(20_001);

        const result = await pendente;
        expect(result.outcome).toBe(CommandOutcome.HandlerError);
        expect(result.reply).toBe(CONTAS_PAGAR_MESSAGES.unavailable);
      } finally {
        jest.useRealTimers();
      }
    });

    it('erro de programacao propaga (o router responde com o texto generico)', async () => {
      const { handler } = montar(LIGADO, () =>
        Promise.reject(new TypeError('bug interno SEGREDO')),
      );

      await expect(handler.handle(contexto())).rejects.toThrow(TypeError);
    });
  });
});

describe('formatDate', () => {
  it('AAAA-MM-DD -> DD/MM/AAAA', () => {
    expect(formatDate('2026-01-05')).toBe('05/01/2026');
  });
});

describe('formatDecimal (sem float)', () => {
  it.each([
    ['0', '0,00'],
    ['5', '5,00'],
    ['5.5', '5,50'],
    ['1234.56', '1.234,56'],
    ['1234567.5', '1.234.567,50'],
    ['1000', '1.000,00'],
    ['-1234.5', '-1.234,50'],
    ['0.001', '0,001'],
    ['1.005', '1,005'],
    ['9007199254740993.10', '9.007.199.254.740.993,10'],
    ['12345678901234567890.123', '12.345.678.901.234.567.890,123'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(formatDecimal(entrada)).toBe(esperado);
  });

  it.each(['abc', '1e5', '1,5', '', '--1'])('fora do formato volta como veio (%p)', (valor) => {
    expect(formatDecimal(valor)).toBe(valor);
  });
});

describe('limite por pessoa (Fase 5.1)', () => {
  const comoUsuario = (id: string): CommandContext => ({
    ...contexto(),
    user: { id } as unknown as CommandContext['user'],
  });

  it('a 4a consulta do minuto da MESMA pessoa e recusada e NAO chega ao Plantae', async () => {
    const { handler, listEntries } = montar();

    const resultados = [];
    for (let i = 0; i < 5; i += 1) {
      resultados.push(await handler.handle(comoUsuario('u1')));
    }

    expect(resultados.map((r) => r.outcome)).toEqual([
      CommandOutcome.Ok,
      CommandOutcome.Ok,
      CommandOutcome.Ok,
      CommandOutcome.HandlerError,
      CommandOutcome.HandlerError,
    ]);
    expect(resultados[3]?.reply).toBe(CONTAS_PAGAR_MESSAGES.throttled);
    expect(listEntries).toHaveBeenCalledTimes(3);
  });

  it('o limite e individual: outra pessoa continua consultando', async () => {
    const { handler, listEntries } = montar();
    for (let i = 0; i < 6; i += 1) {
      await handler.handle(comoUsuario('u1'));
    }

    const outra = await handler.handle(comoUsuario('u2'));

    expect(outra.outcome).toBe(CommandOutcome.Ok);
    expect(listEntries).toHaveBeenCalledTimes(4);
  });

  it('pedido invalido (periodo errado) nao gasta a cota', async () => {
    const { handler } = montar();
    for (let i = 0; i < 6; i += 1) {
      await handler.handle({ ...comoUsuario('u1'), text: '/contas_pagar 2026-10-20 2026-10-01' });
    }

    expect((await handler.handle(comoUsuario('u1'))).outcome).toBe(CommandOutcome.Ok);
  });

  it('desligado nao gasta a cota nem consulta', async () => {
    const { handler, listEntries } = montar({});
    for (let i = 0; i < 6; i += 1) {
      await handler.handle(comoUsuario('u1'));
    }

    expect(listEntries).not.toHaveBeenCalled();
  });
});

describe('Fase 6: prontidao do comando financeiro no chat', () => {
  const contextoDe = (text = '/contas_pagar'): CommandContext => contexto(text);

  describe('aviso de HOMOLOGACAO (M)', () => {
    it('toda resposta com dados, e a de "sem registros", comeca pelo aviso', async () => {
      const cheia = await montar().handler.handle(contextoDe());
      const vazia = await montar(LIGADO, () => Promise.resolve(pagina([]))).handler.handle(
        contextoDe(),
      );

      for (const r of [cheia, vazia]) {
        expect(r.reply.split('\n')[0]).toBe(HOMOLOGATION_BANNER);
      }
      expect(HOMOLOGATION_BANNER).toContain('HOMOLOGACAO');
      expect(HOMOLOGATION_BANNER).toContain('nao sao os dados definitivos');
    });

    it('falhas nao trazem valores (nao ha dado de homologacao para parecer definitivo)', async () => {
      const r = await montar(LIGADO, () =>
        Promise.reject(new PlantaeApiError('server-error')),
      ).handler.handle(contextoDe());

      expect(r.reply).not.toMatch(/R\$|\d+,\d{2}/);
    });
  });

  describe('somente parcelas PENDENTES, mesmo que o Plantae ignore o filtro (E, F, G)', () => {
    const quitada = (): PlantaeEntry =>
      entrada({ parcela_id: 20, status: { codigo: 1, descricao: 'Quitada' } });
    const substituida = (): PlantaeEntry =>
      entrada({ parcela_id: 30, status: { codigo: 2, descricao: 'Substituida' } });

    it('pendente aparece; quitada e substituida nao', async () => {
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(pagina([entrada({ parcela_id: 10 }), quitada(), substituida()])),
      );

      const reply = (await handler.handle(contextoDe())).reply;

      expect(reply).toContain('ref 10');
      expect(reply).not.toContain('ref 20');
      expect(reply).not.toContain('ref 30');
      expect(reply).toContain('Total listado: 1.');
      expect(reply).toContain('2 item(ns) fora do status pendente foram ignorados');
    });

    it('so quitadas/substituidas: tratado como vazio, sem inventar item', async () => {
      const { handler } = montar(LIGADO, () => Promise.resolve(pagina([quitada(), substituida()])));

      const r = await handler.handle(contextoDe());

      expect(r.reply).toContain(CONTAS_PAGAR_MESSAGES.empty);
      expect(r.reply).not.toContain('1)');
      expect(r.auditDetail).toBe('vazio');
    });

    it('o pedido ao Plantae pede SO pendentes (status 0) de despesa', async () => {
      const { handler, listEntries } = montar();

      await handler.handle(contextoDe());

      expect((listEntries.mock.calls[0] as [unknown] | undefined)?.[0]).toMatchObject({
        tipo: 'despesa',
        status: [0],
      });
    });
  });

  describe('limite de itens (defesa contra varredura)', () => {
    it('se o Plantae devolver mais que o maximo, mostra so 5 e avisa que ha mais', async () => {
      const muitas = Array.from({ length: 12 }, (_v, i) => entrada({ parcela_id: 100 + i }));
      const { handler, listEntries } = montar(LIGADO, () => Promise.resolve(pagina(muitas, false)));

      const reply = (await handler.handle(contextoDe())).reply;

      expect(reply.split('\n').filter((l) => /^\d\)/.test(l))).toHaveLength(CHAT_PAGE_SIZE);
      expect(reply).toContain('Ha mais resultados');
      expect(listEntries).toHaveBeenCalledTimes(1);
      expect((listEntries.mock.calls[0] as [unknown] | undefined)?.[0]).toMatchObject({
        perPage: CHAT_PAGE_SIZE,
      });
    });

    it('a resposta com 5 itens cabe no limite do Telegram, mesmo com dados externos enormes', async () => {
      const grandes = Array.from({ length: 5 }, (_v, i) =>
        entrada({
          parcela_id: i,
          pessoa: {
            pessoa_id: i,
            nome: 'N'.repeat(5000),
            razao_social: null,
            tipo_pessoa: 'J',
            cpf_cnpj: null,
          },
        }),
      );
      const { handler } = montar({ ...LIGADO, PLANTAE_CHAT_SHOW_PAYEE_NAME: true }, () =>
        Promise.resolve(pagina(grandes)),
      );

      const reply = (await handler.handle(contextoDe())).reply;

      expect(reply.length).toBeLessThan(1500);
      expect(reply.length).toBeLessThan(4096);
    });
  });

  describe('minimizacao de dados (I)', () => {
    it('por padrao NAO mostra o favorecido; mostra a referencia curta', async () => {
      const reply = (await montar().handler.handle(contextoDe())).reply;

      expect(reply).not.toContain('Fornecedor Ficticio');
      expect(reply).toContain('ref 1');
    });

    it('com a politica ligada, mostra o nome abreviado - e ainda nunca o CPF/CNPJ', async () => {
      const reply = (
        await montar({ ...LIGADO, PLANTAE_CHAT_SHOW_PAYEE_NAME: true }).handler.handle(contextoDe())
      ).reply;

      expect(reply).toContain('Fornecedor Ficticio');
      expect(reply).not.toMatch(/12\.345|12345678/);
    });

    it('nunca devolve dados bancarios, documento, observacao, descricao, rateio nem payload bruto', async () => {
      const reply = (
        await montar({ ...LIGADO, PLANTAE_CHAT_SHOW_PAYEE_NAME: true }).handler.handle(contextoDe())
      ).reply;

      for (const proibido of [
        'DOC-SIGILOSO',
        'DESCRICAO-SIGILOSA',
        'OBSERVACAO-SIGILOSA',
        'rateio',
        '{',
        '"',
      ]) {
        expect(reply).not.toContain(proibido);
      }
    });
  });

  describe('pagamento parcial e valores (semantica de saldo nao documentada)', () => {
    it('parcela com pagamento realizado e SINALIZADA, sem calcular saldo', async () => {
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(
          pagina([entrada({ valor: '1000.00', total_pago: '250.00', saldo_atual: '750.00' })]),
        ),
      );

      const reply = (await handler.handle(contextoDe())).reply;

      expect(reply).toContain('JA TEVE PAGAMENTO PARCIAL');
      expect(reply).toContain('1.000,00');
      expect(reply).not.toContain('750,00');
    });

    it.each([null, '0', '0.00', '0.000'])('total_pago %p: sem sinalizacao', async (pago) => {
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(pagina([entrada({ total_pago: pago })])),
      );

      expect((await handler.handle(contextoDe())).reply).not.toContain('PAGAMENTO PARCIAL');
    });

    it('moedas diferentes ficam cada uma na sua moeda e nunca sao somadas (H)', async () => {
      const dolar = entrada({
        parcela_id: 2,
        valor: '100.00',
        titulo: { ...entrada().titulo, moeda: { moeda_id: 2, nome: 'Dolar', simbolo: 'US$' } },
      });
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(pagina([entrada({ parcela_id: 1, valor: '100.00' }), dolar])),
      );

      const reply = (await handler.handle(contextoDe())).reply;

      expect(reply).toContain('R$ 100,00');
      expect(reply).toContain('US$ 100,00');
      expect(reply).not.toContain('200,00');
    });

    it('valor com mais de 2 casas nao e arredondado', async () => {
      const { handler } = montar(LIGADO, () =>
        Promise.resolve(pagina([entrada({ valor: '10.005' })])),
      );

      expect((await handler.handle(contextoDe())).reply).toContain('R$ 10,005');
    });
  });

  describe('detalhe de auditoria em vocabulario fechado', () => {
    const detalhe = async (
      values: Record<string, unknown>,
      fn?: () => Promise<PlantaePage<PlantaeEntry>>,
    ): Promise<string | undefined> =>
      (await montar(values, fn).handler.handle(contextoDe())).auditDetail;

    it('distingue cada situacao', async () => {
      expect(await detalhe({})).toBe('comando_desligado');
      expect(await detalhe({ PLANTAE_CHAT_COMMANDS_ENABLED: true })).toBe(
        'organizacao_nao_confirmada',
      );
      expect(
        await detalhe({
          PLANTAE_CHAT_COMMANDS_ENABLED: true,
          PLANTAE_ORGANIZATION_CONFIRMED: true,
        }),
      ).toBe('integracao_desligada');
      expect(await detalhe(LIGADO)).toBe('ok');
      expect(await detalhe(LIGADO, () => Promise.resolve(pagina([])))).toBe('vazio');
      expect(await detalhe(LIGADO, () => Promise.reject(new PlantaeApiError('unauthorized')))).toBe(
        'credencial_recusada',
      );
      expect(await detalhe(LIGADO, () => Promise.reject(new PlantaeApiError('rate-limited')))).toBe(
        'limite_fornecedor',
      );
      expect(await detalhe(LIGADO, () => Promise.reject(new PlantaeApiError('server-error')))).toBe(
        'erro_fornecedor',
      );
    });

    it('todo detalhe respeita o formato fechado (nada de conteudo)', async () => {
      const r = await montar(LIGADO).handler.handle(contextoDe());

      expect(r.auditDetail).toMatch(/^[a-z_]{1,40}$/);
    });
  });
});
