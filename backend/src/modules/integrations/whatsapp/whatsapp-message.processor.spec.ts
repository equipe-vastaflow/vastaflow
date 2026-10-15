import { AuditAction } from '../../audit/audit-action.enum';
import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { CommandRouter } from '../../commands/command-router.service';
import { CommandChannel, CommandOutcome, type CommandContext } from '../../commands/command.types';
import { LinkConfirmationOutcome } from '../channels/channel-link';
import { WhatsappApiError } from './whatsapp-api.client';
import type { WhatsappInboundEvent } from './whatsapp-inbound-event.entity';
import type { WhatsappInboundEventsRepository } from './whatsapp-inbound-events.repository';
import { WhatsappMessageProcessor, WHATSAPP_REPLIES } from './whatsapp-message.processor';
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
  sendText: jest.Mock<Promise<void>, [string, string]>;
}

function montar(
  opcoes: {
    claimed?: boolean;
    user?: AuthenticatedUser | null;
    link?: LinkConfirmationOutcome;
    result?: { outcome: CommandOutcome; reply: string };
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
  const sendText = jest.fn((_to: string, _t: string) => Promise.resolve());
  const processor = new WhatsappMessageProcessor(
    () => '1234567890',
    { claim, finish } as unknown as WhatsappInboundEventsRepository,
    { resolve },
    { tryConfirm },
    { execute } as unknown as CommandRouter,
    { record } as unknown as AuditService,
    { sendText },
    () => AGORA,
  );
  return { processor, claim, finish, resolve, tryConfirm, execute, record, sendText };
}

describe('WhatsappMessageProcessor', () => {
  it('vinculado e autorizado: executa pelo Command Engine e responde NO MESMO numero', async () => {
    const m = montar();

    expect(await m.processor.process(msg())).toBe('EXECUTED');

    expect(m.execute.mock.calls[0]?.[0]).toMatchObject({
      user: USER,
      channel: CommandChannel.Whatsapp,
      conversationId: '5511999990000',
      text: '/ajuda',
    });
    expect(m.sendText).toHaveBeenCalledWith('5511999990000', 'Comandos disponiveis');
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

  it('numero NAO vinculado: UNLINKED, nada executa', async () => {
    const m = montar({ user: null });

    expect(await m.processor.process(msg({ text: '/financeiro' }))).toBe('UNLINKED');
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.sendText).toHaveBeenCalledWith('5511999990000', WHATSAPP_REPLIES.unlinked);
    expect(m.record.mock.calls[0]?.[0] as Record<string, unknown>).not.toHaveProperty('usuarioId');
  });

  it('RBAC: permissao negada vira DENIED com a resposta do motor', async () => {
    const m = montar({
      result: { outcome: CommandOutcome.PermissionDenied, reply: 'Voce nao tem permissao' },
    });

    expect(await m.processor.process(msg({ text: '/financeiro' }))).toBe('DENIED');
    expect(m.sendText).toHaveBeenCalledWith('5511999990000', 'Voce nao tem permissao');
  });

  it('comando desconhecido e erro do handler sao classificados', async () => {
    expect(
      await montar({
        result: { outcome: CommandOutcome.UnknownCommand, reply: 'x' },
      }).processor.process(msg()),
    ).toBe('UNKNOWN_COMMAND');
    expect(
      await montar({
        result: { outcome: CommandOutcome.HandlerError, reply: 'x' },
      }).processor.process(msg()),
    ).toBe('FAILED');
  });

  describe('vinculo por /vincular', () => {
    it.each([
      [LinkConfirmationOutcome.Confirmed, 'LINK_CONFIRMED', WHATSAPP_REPLIES.linked],
      [LinkConfirmationOutcome.Rejected, 'LINK_REJECTED', WHATSAPP_REPLIES.linkRejected],
      [LinkConfirmationOutcome.AlreadyLinked, 'LINK_REJECTED', WHATSAPP_REPLIES.alreadyLinked],
    ])('%s', async (link, esperado, resposta) => {
      const m = montar({ link, user: null });

      expect(await m.processor.process(msg({ text: '/vincular ABCD-EFGH-JKLM' }))).toBe(esperado);
      expect(m.execute).not.toHaveBeenCalled();
      expect(m.sendText).toHaveBeenCalledWith('5511999990000', resposta);
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

      expect(await m.processor.process(msg({ text: '/vincular X' }))).toBe('LINK_REJECTED');
    });
  });

  describe('protecoes antes de executar', () => {
    it('numero de OUTRO phone_number_id: ignorado, nem reserva', async () => {
      const m = montar();

      expect(await m.processor.process(msg({ phoneNumberId: '999999' }))).toBe('IGNORED');
      expect(m.claim).not.toHaveBeenCalled();
    });

    it('mensagem com mais de 10 min: descartada sem executar e sem responder', async () => {
      const m = montar();

      expect(await m.processor.process(msg({ timestamp: 1_790_000_100 - 11 * 60 }))).toBe('STALE');
      expect(m.claim).not.toHaveBeenCalled();
      expect(m.sendText).not.toHaveBeenCalled();
    });

    it('entrega repetida da Meta (mesmo wamid): DUPLICATE, nada executa nem responde', async () => {
      const m = montar({ claimed: false });

      expect(await m.processor.process(msg())).toBe('DUPLICATE');
      expect(m.execute).not.toHaveBeenCalled();
      expect(m.sendText).not.toHaveBeenCalled();
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

    it('limite por remetente: 10 passam, o excesso e descartado com UM aviso; outro numero nao e afetado', async () => {
      const m = montar();
      const resultados: string[] = [];
      for (let i = 0; i < 13; i += 1) {
        resultados.push(await m.processor.process(msg({ messageId: `wamid.${String(i)}` })));
      }

      expect(resultados.filter((r) => r === 'EXECUTED')).toHaveLength(10);
      expect(resultados.filter((r) => r === 'RATE_LIMITED')).toHaveLength(3);
      expect(
        m.sendText.mock.calls.filter(([, t]) => t === WHATSAPP_REPLIES.rateLimited),
      ).toHaveLength(1);
      expect(
        await m.processor.process(msg({ messageId: 'wamid.outro', from: '5511888880000' })),
      ).toBe('EXECUTED');
    });
  });

  describe('falhas nunca lancam', () => {
    it('envio falha: segue (log so com a categoria)', async () => {
      const m = montar();
      m.sendText.mockRejectedValue(new WhatsappApiError('http', 500));

      expect(await m.processor.process(msg())).toBe('EXECUTED');
    });

    it('banco fora ao reservar: FAILED, nada executa', async () => {
      const m = montar();
      m.claim.mockRejectedValue(new Error('db fora'));

      expect(await m.processor.process(msg())).toBe('FAILED');
      expect(m.execute).not.toHaveBeenCalled();
    });

    it('resolvedor falha: tratado como nao vinculado (nunca acesso liberado)', async () => {
      const m = montar();
      m.resolve.mockRejectedValue(new Error('db fora'));

      expect(await m.processor.process(msg())).toBe('UNLINKED');
      expect(m.execute).not.toHaveBeenCalled();
    });
  });

  it('resposta longa e cortada em 4096', async () => {
    const m = montar({ result: { outcome: CommandOutcome.Ok, reply: 'x'.repeat(9000) } });

    await m.processor.process(msg());

    expect((m.sendText.mock.calls[0]?.[1] ?? '').length).toBe(4096);
  });
});
