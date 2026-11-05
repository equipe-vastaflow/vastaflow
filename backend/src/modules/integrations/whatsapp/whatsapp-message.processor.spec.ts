import { AuditAction } from '../../audit/audit-action.enum';
import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { CommandRouter } from '../../commands/command-router.service';
import { CommandChannel, CommandOutcome, type CommandContext } from '../../commands/command.types';
import { LinkConfirmationOutcome } from '../channels/channel-link';
import type { WhatsappInboundEvent } from './whatsapp-inbound-event.entity';
import type { WhatsappInboundEventsRepository } from './whatsapp-inbound-events.repository';
import {
  MESSAGE_MAX_FUTURE_SKEW_MS,
  WhatsappMessageProcessor,
  WHATSAPP_REPLIES,
} from './whatsapp-message.processor';
import type { InboundWhatsappText } from './whatsapp-payload';

const AGORA = 1_790_000_100_000;
const USER = { id: 'user-1' } as unknown as AuthenticatedUser;

const msg = (over: Partial<InboundWhatsappText> = {}): InboundWhatsappText => ({
  phoneNumberId: '1234567890',
  messageId: 'wamid.A',
  from: '5511999990000',
  text: '/ajuda',
  timestamp: 1_790_000_090,
  ...over,
});

interface Montagem {
  processor: WhatsappMessageProcessor;
  claim: jest.Mock<Promise<WhatsappInboundEvent | null>, []>;
  finish: jest.Mock<Promise<void>, unknown[]>;
  resolve: jest.Mock<Promise<AuthenticatedUser | null>, []>;
  tryConfirm: jest.Mock<Promise<LinkConfirmationOutcome>, []>;
  execute: jest.Mock<
    Promise<{ success: boolean; outcome: CommandOutcome; reply: string }>,
    [CommandContext]
  >;
  record: jest.Mock<Promise<void>, [unknown]>;
}

function montar(
  opcoes: {
    claimed?: boolean;
    user?: AuthenticatedUser | null;
    link?: LinkConfirmationOutcome;
    result?: { outcome: CommandOutcome; reply: string };
    replyToUnlinked?: boolean;
  } = {},
): Montagem {
  const claim = jest.fn(() =>
    Promise.resolve(opcoes.claimed === false ? null : ({ id: 'evt-1' } as WhatsappInboundEvent)),
  );
  const finish = jest.fn((..._a: unknown[]) => Promise.resolve());
  const resolve = jest.fn(() => Promise.resolve('user' in opcoes ? (opcoes.user ?? null) : USER));
  const tryConfirm = jest.fn(() =>
    Promise.resolve(opcoes.link ?? LinkConfirmationOutcome.NotAttempted),
  );
  const execute = jest.fn((_c: CommandContext) =>
    Promise.resolve({
      success: true,
      outcome: opcoes.result?.outcome ?? CommandOutcome.Ok,
      reply: opcoes.result?.reply ?? 'Comandos disponiveis',
    }),
  );
  const record = jest.fn((_e: unknown) => Promise.resolve());
  const processor = new WhatsappMessageProcessor(
    () => '1234567890',
    { claim, finish } as unknown as WhatsappInboundEventsRepository,
    { resolve },
    { tryConfirm },
    { execute } as unknown as CommandRouter,
    { record } as unknown as AuditService,
    () => AGORA,
    () => opcoes.replyToUnlinked === true,
  );
  return { processor, claim, finish, resolve, tryConfirm, execute, record };
}

describe('WhatsappMessageProcessor', () => {
  it('vinculado e autorizado: executa pelo Command Engine e DEVOLVE a resposta (nao envia nada)', async () => {
    const m = montar();

    const result = await m.processor.process(msg());

    expect(result).toEqual({
      outcome: 'EXECUTED',
      reply: 'Comandos disponiveis',
      correlationId: 'evt-1',
    });

    expect(m.execute.mock.calls[0]?.[0]).toMatchObject({
      user: USER,
      channel: CommandChannel.Whatsapp,
      conversationId: '5511999990000',
      text: '/ajuda',
    });
  });

  it('a auditoria traz a PESSOA e o canal, sem texto, sem numero e sem resposta', async () => {
    const m = montar();

    await m.processor.process(msg({ text: '/ajuda SENTINELA' }));

    const evento = m.record.mock.calls[0]?.[0] as {
      usuarioId: string;
      acao: string;
      metadados: Record<string, unknown>;
    };
    expect(evento.acao).toBe(AuditAction.ChannelMessage);
    expect(evento.usuarioId).toBe('user-1');
    expect(evento.metadados).toMatchObject({
      canal: 'whatsapp',
      resultado: 'EXECUTED',
      autorizacao: 'AUTORIZADO',
      comando: 'ajuda',
      origem: 'webhook-meta',
    });
    const bruto = JSON.stringify(evento);
    expect(bruto).not.toContain('SENTINELA');
    expect(bruto).not.toContain('5511999990000');
    expect(bruto).not.toContain('Comandos disponiveis');
  });

  it('numero NAO vinculado: UNLINKED, nada executa e, por padrao, NADA e respondido (cliente da empresa nao recebe bot)', async () => {
    const m = montar({ user: null });

    const result = await m.processor.process(msg({ text: '/financeiro' }));
    expect(result.outcome).toBe('UNLINKED');
    expect(m.execute).not.toHaveBeenCalled();
    expect(result.reply).toBeNull();
    // A tentativa continua auditada (sem numero e sem texto).
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record.mock.calls[0]?.[0] as Record<string, unknown>).not.toHaveProperty('usuarioId');
  });

  it('com WHATSAPP_REPLY_TO_UNLINKED=true o aviso de vinculo e enviado', async () => {
    const m = montar({ user: null, replyToUnlinked: true });

    const result = await m.processor.process(msg({ text: '/financeiro' }));

    expect(result.outcome).toBe('UNLINKED');
    expect(m.execute).not.toHaveBeenCalled();
    expect(result.reply).toBe(WHATSAPP_REPLIES.unlinked);
  });

  it('conversa comum de cliente (texto livre, saudacao, pergunta) de numero desconhecido: silencio total', async () => {
    const m = montar({ user: null });

    for (const [i, text] of [
      'Oi, tudo bem?',
      'Quanto custa o servico?',
      '/ajuda',
      'bom dia',
    ].entries()) {
      expect(
        await m.processor.process(msg({ text, messageId: `wamid.cliente${String(i)}` })),
      ).toMatchObject({ outcome: 'UNLINKED', reply: null });
    }
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('/vincular de numero desconhecido SEMPRE recebe resposta (comando explicito), mesmo no modo silencioso', async () => {
    const aceito = montar({ user: null, link: LinkConfirmationOutcome.Confirmed });
    expect(await aceito.processor.process(msg({ text: '/vincular ABCD1234' }))).toMatchObject({
      outcome: 'LINK_CONFIRMED',
      reply: WHATSAPP_REPLIES.linked,
    });
    const recusado = montar({ user: null, link: LinkConfirmationOutcome.Rejected });
    expect(await recusado.processor.process(msg({ text: '/vincular ABCD1234' }))).toMatchObject({
      outcome: 'LINK_REJECTED',
      reply: WHATSAPP_REPLIES.linkRejected,
    });
  });

  it('RBAC: permissao negada vira DENIED com a resposta do motor', async () => {
    const m = montar({
      result: { outcome: CommandOutcome.PermissionDenied, reply: 'Voce nao tem permissao' },
    });

    expect(await m.processor.process(msg({ text: '/financeiro' }))).toMatchObject({
      outcome: 'DENIED',
      reply: 'Voce nao tem permissao',
    });
  });

  it('comando desconhecido e erro do handler sao classificados', async () => {
    expect(
      (
        await montar({
          result: { outcome: CommandOutcome.UnknownCommand, reply: 'x' },
        }).processor.process(msg())
      ).outcome,
    ).toBe('UNKNOWN_COMMAND');
    expect(
      (
        await montar({
          result: { outcome: CommandOutcome.HandlerError, reply: 'x' },
        }).processor.process(msg())
      ).outcome,
    ).toBe('FAILED');
  });

  describe('vinculo por /vincular', () => {
    it.each([
      [LinkConfirmationOutcome.Confirmed, 'LINK_CONFIRMED', WHATSAPP_REPLIES.linked],
      [LinkConfirmationOutcome.Rejected, 'LINK_REJECTED', WHATSAPP_REPLIES.linkRejected],
      [LinkConfirmationOutcome.AlreadyLinked, 'LINK_REJECTED', WHATSAPP_REPLIES.alreadyLinked],
    ])('%s', async (link, esperado, resposta) => {
      const m = montar({ link, user: null });

      expect(await m.processor.process(msg({ text: '/vincular ABCD-EFGH-JKLM' }))).toMatchObject({
        outcome: esperado,
        reply: resposta,
      });
      expect(m.execute).not.toHaveBeenCalled();
      expect(JSON.stringify(m.record.mock.calls)).not.toContain('ABCD-EFGH-JKLM');
    });

    it('o confirmador recebe a identidade do WhatsApp (canal whatsapp, wa_id)', async () => {
      const m = montar();

      await m.processor.process(msg());

      expect(m.tryConfirm).toHaveBeenCalledWith(
        { channel: 'whatsapp', externalId: '5511999990000' },
        '/ajuda',
      );
    });

    it('falha do confirmador conta como recusa, nunca como vinculo', async () => {
      const m = montar({ user: null });
      m.tryConfirm.mockRejectedValue(new Error('db fora'));

      expect((await m.processor.process(msg({ text: '/vincular X' }))).outcome).toBe(
        'LINK_REJECTED',
      );
    });
  });

  describe('protecoes antes de executar', () => {
    it('numero de OUTRO phone_number_id: ignorado, nem reserva', async () => {
      const m = montar();

      expect((await m.processor.process(msg({ phoneNumberId: '999999' }))).outcome).toBe('IGNORED');
      expect(m.claim).not.toHaveBeenCalled();
    });

    it('mensagem com mais de 10 min: descartada sem executar e sem responder', async () => {
      const m = montar();

      expect(await m.processor.process(msg({ timestamp: 1_790_000_100 - 11 * 60 }))).toEqual({
        outcome: 'STALE',
        reply: null,
        correlationId: null,
      });
      expect(m.claim).not.toHaveBeenCalled();
    });

    it('mensagem DO FUTURO alem da tolerancia: descartada (relogio errado nao contorna a idade maxima)', async () => {
      const m = montar();
      const adiante = (AGORA + MESSAGE_MAX_FUTURE_SKEW_MS + 2_000) / 1000;

      expect((await m.processor.process(msg({ timestamp: adiante }))).outcome).toBe('STALE');
      expect(m.claim).not.toHaveBeenCalled();
      // Dentro da tolerancia (pequena diferenca de relogio) segue normalmente.
      expect(
        (
          await m.processor.process(
            msg({ timestamp: (AGORA + 30_000) / 1000, messageId: 'wamid.B' }),
          )
        ).outcome,
      ).toBe('EXECUTED');
    });

    it('entrega repetida da Meta (mesmo wamid): DUPLICATE, nada executa nem responde', async () => {
      const m = montar({ claimed: false });

      expect(await m.processor.process(msg())).toEqual({
        outcome: 'DUPLICATE',
        reply: null,
        correlationId: null,
      });
      expect(m.execute).not.toHaveBeenCalled();
      expect(m.record).not.toHaveBeenCalled();
    });

    it('a reserva acontece ANTES de qualquer execucao', async () => {
      const m = montar();
      const ordem: string[] = [];
      m.claim.mockImplementation(() => {
        ordem.push('claim');
        return Promise.resolve({ id: 'evt-1' } as WhatsappInboundEvent);
      });
      m.execute.mockImplementation(() => {
        ordem.push('execute');
        return Promise.resolve({ success: true, outcome: CommandOutcome.Ok, reply: 'ok' });
      });

      await m.processor.process(msg());

      expect(ordem).toEqual(['claim', 'execute']);
    });

    it('limite por remetente: 10 passam, o excesso e descartado (sem aviso por padrao); outro numero nao e afetado', async () => {
      const m = montar();
      const resultados: Awaited<ReturnType<WhatsappMessageProcessor['process']>>[] = [];
      for (let i = 0; i < 13; i += 1) {
        resultados.push(await m.processor.process(msg({ messageId: `wamid.${String(i)}` })));
      }

      expect(resultados.filter((r) => r.outcome === 'EXECUTED')).toHaveLength(10);
      expect(resultados.filter((r) => r.outcome === 'RATE_LIMITED')).toHaveLength(3);
      // Padrao silencioso: o excesso e descartado sem aviso a ninguem.
      expect(resultados.filter((r) => r.reply === WHATSAPP_REPLIES.rateLimited)).toHaveLength(0);
      expect(
        (await m.processor.process(msg({ messageId: 'wamid.outro', from: '5511888880000' })))
          .outcome,
      ).toBe('EXECUTED');
    });
  });

  describe('aviso de limite (so com WHATSAPP_REPLY_TO_UNLINKED=true)', () => {
    it('envia UM aviso por janela', async () => {
      const m = montar({ replyToUnlinked: true });
      const avisos: (string | null)[] = [];
      for (let i = 0; i < 13; i += 1) {
        avisos.push(
          (await m.processor.process(msg({ messageId: `wamid.aviso${String(i)}` }))).reply,
        );
      }
      expect(avisos.filter((r) => r === WHATSAPP_REPLIES.rateLimited)).toHaveLength(1);
    });
  });

  describe('falhas nunca lancam', () => {
    it('banco fora ao reservar: FAILED, nada executa', async () => {
      const m = montar();
      m.claim.mockRejectedValue(new Error('db fora'));

      expect(await m.processor.process(msg())).toEqual({
        outcome: 'FAILED',
        reply: null,
        correlationId: null,
      });
      expect(m.execute).not.toHaveBeenCalled();
    });

    it('resolvedor falha: tratado como nao vinculado (nunca acesso liberado)', async () => {
      const m = montar();
      m.resolve.mockRejectedValue(new Error('db fora'));

      expect((await m.processor.process(msg())).outcome).toBe('UNLINKED');
      expect(m.execute).not.toHaveBeenCalled();
    });
  });

  it('resposta longa e cortada em 4096', async () => {
    const m = montar({ result: { outcome: CommandOutcome.Ok, reply: 'x'.repeat(9000) } });

    const result = await m.processor.process(msg());

    expect((result.reply ?? '').length).toBe(4096);
  });

  describe('contexto do transporte (auditoria)', () => {
    const registrado = (m: Montagem): Record<string, unknown> =>
      (m.record.mock.calls[0]?.[0] as { metadados: Record<string, unknown> }).metadados;

    it('padrao (webhook da Meta): origem webhook-meta, sem principal', async () => {
      const m = montar();

      await m.processor.process(msg());

      expect(registrado(m)).toMatchObject({ origem: 'webhook-meta' });
      expect(registrado(m)).not.toHaveProperty('principal');
    });

    it('gateway: registra origem, principal e credencial (sem texto nem numero)', async () => {
      const m = montar();

      await m.processor.process(msg({ text: '/ajuda SENTINELA' }), {
        origem: 'gateway-baileys',
        principal: 'whatsapp-gateway',
        servicoId: 'gw-1',
      });

      expect(registrado(m)).toMatchObject({
        origem: 'gateway-baileys',
        principal: 'whatsapp-gateway',
        servicoId: 'gw-1',
        canal: 'whatsapp',
        resultado: 'EXECUTED',
      });
      const bruto = JSON.stringify(m.record.mock.calls);
      expect(bruto).not.toContain('SENTINELA');
      expect(bruto).not.toContain('5511999990000');
    });

    it('o RBAC e do VINCULADO ao remetente, nao do contexto: o principal do gateway nao entra na decisao', async () => {
      const m = montar({ user: null });

      await m.processor.process(msg({ text: '/financeiro' }), {
        origem: 'gateway-baileys',
        principal: 'whatsapp-gateway',
        servicoId: 'gw-1',
      });

      expect(m.execute).not.toHaveBeenCalled();
    });
  });
});
