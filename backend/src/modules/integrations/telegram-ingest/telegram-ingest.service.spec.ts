import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import type { AuditService } from '../../audit/audit.service';
import { CommandOutcome } from '../../commands/command.types';
import {
  ServicePrincipalId,
  ServiceScope,
  type AuthenticatedService,
} from '../../service-auth/service-principals';
import {
  TelegramUpdateOutcome,
  type ProcessedMessage,
  type TelegramAdapter,
} from '../telegram/telegram.adapter';
import { signEnvelope, verifyReply, type TelegramEnvelope } from '../telegram/telegram-envelope';
import { InboundEventStatus, type TelegramInboundEvent } from './telegram-inbound-event.entity';
import type { TelegramInboundEventsRepository } from './telegram-inbound-events.repository';
import { INGEST_FAILURE_REPLY, TelegramIngestService } from './telegram-ingest.service';

const KEY = 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres-0123';
const AGORA = 1_790_000_005_000;
const SERVICE: AuthenticatedService = {
  principal: ServicePrincipalId.N8nTelegram,
  credentialId: 'cred-1',
  scopes: [ServiceScope.TelegramIngest],
};

function envelope(over: Partial<TelegramEnvelope> = {}): TelegramEnvelope {
  return {
    version: 'v1',
    platform: 'telegram',
    botId: '123456789',
    updateId: 1001,
    messageId: 55,
    chatId: '777',
    userId: '777',
    chatType: 'private',
    text: '/ajuda',
    sentAt: 1_790_000_000,
    issuedAt: AGORA,
    ...over,
  };
}

function processed(over: Partial<ProcessedMessage> = {}): ProcessedMessage {
  return {
    outcome: TelegramUpdateOutcome.Executed,
    reply: 'Comandos disponiveis',
    userId: 'user-1',
    commandOutcome: CommandOutcome.Ok,
    command: 'ajuda',
    ...over,
  };
}

interface Montagem {
  service: TelegramIngestService;
  claim: jest.Mock;
  finish: jest.Mock;
  find: jest.Mock;
  processMessage: jest.Mock;
  record: jest.Mock;
}

function montar(opcoes: { key?: string | undefined; claimed?: boolean } = {}): Montagem {
  const claim = jest
    .fn()
    .mockResolvedValue(opcoes.claimed === false ? null : ({ id: 'evt-1' } as TelegramInboundEvent));
  const finish = jest.fn().mockResolvedValue(undefined);
  const find = jest.fn().mockResolvedValue({ id: 'evt-original' });
  const processMessage = jest.fn().mockResolvedValue(processed());
  const record = jest.fn().mockResolvedValue(undefined);
  const key = 'key' in opcoes ? opcoes.key : KEY;
  const service = new TelegramIngestService(
    { get: <T>() => key as T },
    { claim, finish, findByUpdate: find } as unknown as TelegramInboundEventsRepository,
    { processMessage } as unknown as TelegramAdapter,
    { record } as unknown as AuditService,
    () => AGORA,
  );
  return { service, claim, finish, find, processMessage, record };
}

interface Auditado {
  readonly acao: string;
  readonly modulo: string;
  readonly usuarioId?: string;
  readonly metadados: Record<string, unknown>;
}

function primeiraAuditoria(m: Montagem): Auditado {
  return (m.record.mock.calls[0] as [Auditado])[0];
}

function entrada(
  env: TelegramEnvelope,
  assinatura?: string,
): { envelope: TelegramEnvelope; signature: string } {
  return { envelope: env, signature: assinatura ?? signEnvelope(env, KEY) };
}

describe('TelegramIngestService', () => {
  describe('autenticidade do envelope (nada executa antes)', () => {
    it('assinatura invalida: 403, auditoria, nada reservado nem executado', async () => {
      const m = montar();
      const env = envelope();

      await expect(m.service.ingest(entrada(env, 'a'.repeat(64)), SERVICE)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(m.claim).not.toHaveBeenCalled();
      expect(m.processMessage).not.toHaveBeenCalled();
      expect(m.record).toHaveBeenCalledTimes(1);
      expect(primeiraAuditoria(m)).toMatchObject({
        acao: AuditAction.ChannelMessage,
        modulo: AuditModuleName.Channels,
        metadados: { resultado: 'ENVELOPE_REJECTED', motivo: 'assinatura' },
      });
    });

    it('identidade adulterada depois de assinar (userId/chatId): recusada', async () => {
      const m = montar();
      const original = envelope();
      const assinatura = signEnvelope(original, KEY);

      await expect(
        m.service.ingest(
          { envelope: envelope({ userId: '999', chatId: '999' }), signature: assinatura },
          SERVICE,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(m.processMessage).not.toHaveBeenCalled();
    });

    it('assinado com outra chave: recusado', async () => {
      const m = montar();
      const env = envelope();

      await expect(
        m.service.ingest({ envelope: env, signature: signEnvelope(env, 'x'.repeat(40)) }, SERVICE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('envelope expirado (assinatura boa): recusado como replay', async () => {
      const m = montar();
      const velho = envelope({ issuedAt: AGORA - 6 * 60 * 1000 });

      await expect(m.service.ingest(entrada(velho), SERVICE)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(primeiraAuditoria(m).metadados.motivo).toBe('expirado');
      expect(m.claim).not.toHaveBeenCalled();
    });

    it('envelope do futuro alem da tolerancia: recusado', async () => {
      const m = montar();

      await expect(
        m.service.ingest(entrada(envelope({ issuedAt: AGORA + 61_000 })), SERVICE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('chat diferente do remetente (mesmo assinado): recusado', async () => {
      const m = montar();

      await expect(
        m.service.ingest(entrada(envelope({ chatId: '888' })), SERVICE),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(primeiraAuditoria(m).metadados.motivo).toBe('inconsistente');
    });

    it('a auditoria de recusa NAO leva usuarioId (id de remetente nao autenticado e dado do atacante)', async () => {
      const m = montar();

      await m.service.ingest(entrada(envelope(), 'b'.repeat(64)), SERVICE).catch(() => undefined);

      expect(primeiraAuditoria(m)).not.toHaveProperty('usuarioId');
    });
  });

  describe('sem chave configurada (fail-closed)', () => {
    it.each([undefined, '', 'curta'])('chave %p: 503, nada executa', async (key) => {
      const m = montar({ key });

      await expect(m.service.ingest(entrada(envelope()), SERVICE)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(m.claim).not.toHaveBeenCalled();
      expect(m.processMessage).not.toHaveBeenCalled();
    });
  });

  describe('idempotencia', () => {
    it('update ja reservado: duplicada, SEM executar e SEM resposta', async () => {
      const m = montar({ claimed: false });

      const out = await m.service.ingest(entrada(envelope()), SERVICE);

      expect(out).toEqual({
        correlationId: 'evt-original',
        outcome: 'DUPLICATE',
        duplicate: true,
        reply: null,
        signature: null,
      });
      expect(m.processMessage).not.toHaveBeenCalled();
      expect(primeiraAuditoria(m).metadados).toMatchObject({
        resultado: 'DUPLICATE',
        correlacao: 'evt-original',
      });
    });

    it('a reserva usa (canal, bot, update) do envelope ASSINADO', async () => {
      const m = montar();

      await m.service.ingest(entrada(envelope({ updateId: 4242, botId: '55' })), SERVICE);

      expect(m.claim).toHaveBeenCalledWith('telegram', '55', 4242);
    });

    it('reserva ocorre ANTES de executar o comando', async () => {
      const m = montar();
      const ordem: string[] = [];
      m.claim.mockImplementation(() => {
        ordem.push('claim');
        return Promise.resolve({ id: 'evt-1' });
      });
      m.processMessage.mockImplementation(() => {
        ordem.push('process');
        return Promise.resolve(processed());
      });

      await m.service.ingest(entrada(envelope()), SERVICE);

      expect(ordem).toEqual(['claim', 'process']);
    });

    it('falha ao reservar (banco): propaga e NAO executa o comando', async () => {
      const m = montar();
      m.claim.mockRejectedValue(new Error('db fora'));

      await expect(m.service.ingest(entrada(envelope()), SERVICE)).rejects.toThrow('db fora');
      expect(m.processMessage).not.toHaveBeenCalled();
    });
  });

  describe('desfechos', () => {
    const casos: Array<[string, Partial<ProcessedMessage>, string, string, InboundEventStatus]> = [
      ['executado', {}, 'EXECUTED', 'AUTORIZADO', InboundEventStatus.Concluido],
      [
        'permissao negada',
        { commandOutcome: CommandOutcome.PermissionDenied, reply: 'Sem permissao' },
        'DENIED',
        'NEGADO',
        InboundEventStatus.Concluido,
      ],
      [
        'nao vinculado',
        {
          outcome: TelegramUpdateOutcome.Unlinked,
          userId: null,
          commandOutcome: null,
          command: null,
        },
        'UNLINKED',
        'NAO_VINCULADO',
        InboundEventStatus.Concluido,
      ],
      [
        'comando desconhecido',
        { commandOutcome: CommandOutcome.UnknownCommand, command: null },
        'UNKNOWN_COMMAND',
        'IDENTIFICADO',
        InboundEventStatus.Concluido,
      ],
      [
        'texto comum',
        { commandOutcome: CommandOutcome.NotACommand, command: null },
        'UNKNOWN_COMMAND',
        'IDENTIFICADO',
        InboundEventStatus.Concluido,
      ],
      [
        'erro no handler',
        { commandOutcome: CommandOutcome.HandlerError },
        'FAILED',
        'AUTORIZADO',
        InboundEventStatus.Falhou,
      ],
      [
        'vinculo (nao deveria chegar aqui)',
        { outcome: TelegramUpdateOutcome.LinkConfirmed },
        'FAILED',
        'N/A',
        InboundEventStatus.Falhou,
      ],
    ];

    it.each(casos)('%s', async (_nome, over, outcome, autorizacao, status) => {
      const m = montar();
      m.processMessage.mockResolvedValue(processed(over));

      const out = await m.service.ingest(entrada(envelope()), SERVICE);

      expect(out.outcome).toBe(outcome);
      expect(out.duplicate).toBe(false);
      expect(m.finish).toHaveBeenCalledWith(
        'evt-1',
        status,
        outcome,
        'userId' in over ? over.userId : 'user-1',
      );
      expect(primeiraAuditoria(m).metadados).toMatchObject({
        resultado: outcome,
        autorizacao,
        principal: ServicePrincipalId.N8nTelegram,
        servicoId: 'cred-1',
        correlacao: 'evt-1',
      });
    });

    it('chama o adaptador SEM permitir vinculo e com a identidade do envelope assinado', async () => {
      const m = montar();

      await m.service.ingest(
        entrada(envelope({ text: '/status', userId: '777', chatId: '777' })),
        SERVICE,
      );

      const [mensagem, opcoes] = m.processMessage.mock.calls[0] as [unknown, unknown];
      expect(opcoes).toEqual({ allowLinking: false });
      expect(mensagem).toMatchObject({
        channel: 'telegram',
        conversationId: '777',
        sender: { channel: 'telegram', externalId: '777' },
        text: '/status',
      });
    });

    it('o ator da auditoria e a PESSOA resolvida, nao o servico', async () => {
      const m = montar();

      await m.service.ingest(entrada(envelope()), SERVICE);

      expect(primeiraAuditoria(m).usuarioId).toBe('user-1');
      expect(primeiraAuditoria(m).metadados.principal).toBe('n8n-telegram');
    });

    it('nao vinculado: auditoria SEM usuarioId', async () => {
      const m = montar();
      m.processMessage.mockResolvedValue(
        processed({
          outcome: TelegramUpdateOutcome.Unlinked,
          userId: null,
          commandOutcome: null,
          command: null,
        }),
      );

      await m.service.ingest(entrada(envelope()), SERVICE);

      expect(primeiraAuditoria(m)).not.toHaveProperty('usuarioId');
    });
  });

  describe('falha ao avaliar', () => {
    it('adaptador lanca: FAILED, texto padrao, evento fechado como FALHOU, sem vazar a causa', async () => {
      const m = montar();
      m.processMessage.mockRejectedValue(new Error('SEGREDO-INTERNO-123'));

      const out = await m.service.ingest(entrada(envelope()), SERVICE);

      expect(out.outcome).toBe('FAILED');
      expect(out.reply).toBe(INGEST_FAILURE_REPLY);
      expect(JSON.stringify(out)).not.toContain('SEGREDO-INTERNO-123');
      expect(m.finish).toHaveBeenCalledWith('evt-1', InboundEventStatus.Falhou, 'FAILED', null);
    });
  });

  describe('resposta assinada', () => {
    it('e amarrada ao envelope e confere com a chave', async () => {
      const m = montar();
      const env = envelope();

      const out = await m.service.ingest(entrada(env), SERVICE);

      expect(
        verifyReply(
          env,
          { outcome: out.outcome, reply: out.reply ?? '', signature: out.signature ?? '' },
          KEY,
        ),
      ).toBe(true);
      expect(
        verifyReply(
          envelope({ updateId: 1002 }),
          { outcome: out.outcome, reply: out.reply ?? '', signature: out.signature ?? '' },
          KEY,
        ),
      ).toBe(false);
    });
  });

  describe('o que a auditoria NAO guarda', () => {
    it('nem o texto da mensagem, nem a resposta, nem o id do Telegram', async () => {
      const m = montar();
      m.processMessage.mockResolvedValue(processed({ reply: 'RESPOSTA-SIGILOSA-XYZ' }));

      await m.service.ingest(
        entrada(
          envelope({
            text: '/financeiro TEXTO-SIGILOSO-ABC',
            userId: '31415926',
            chatId: '31415926',
          }),
        ),
        SERVICE,
      );

      const auditado = JSON.stringify(m.record.mock.calls);
      expect(auditado).not.toContain('TEXTO-SIGILOSO-ABC');
      expect(auditado).not.toContain('RESPOSTA-SIGILOSA-XYZ');
      expect(auditado).not.toContain('31415926');
      expect(auditado).not.toContain(KEY);
    });

    it('a auditoria de recusa tambem nao leva o texto', async () => {
      const m = montar();

      await m.service
        .ingest(entrada(envelope({ text: 'TEXTO-SIGILOSO-ABC' }), 'c'.repeat(64)), SERVICE)
        .catch(() => undefined);

      expect(JSON.stringify(m.record.mock.calls)).not.toContain('TEXTO-SIGILOSO-ABC');
    });
  });
  describe('idade da MENSAGEM (Fase 5.1)', () => {
    it('mensagem antiga com envelope novo e assinatura valida: recusada como antiga', async () => {
      const m = montar();
      const antiga = envelope({ sentAt: Math.floor(AGORA / 1000) - 11 * 60 });

      await expect(m.service.ingest(entrada(antiga), SERVICE)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(primeiraAuditoria(m).metadados.motivo).toBe('antigo');
      expect(m.claim).not.toHaveBeenCalled();
      expect(m.processMessage).not.toHaveBeenCalled();
    });

    it('mensagem recente (controle positivo) executa', async () => {
      const m = montar();

      const out = await m.service.ingest(
        entrada(envelope({ sentAt: Math.floor(AGORA / 1000) - 60 })),
        SERVICE,
      );

      expect(out.outcome).toBe('EXECUTED');
    });
  });
});
