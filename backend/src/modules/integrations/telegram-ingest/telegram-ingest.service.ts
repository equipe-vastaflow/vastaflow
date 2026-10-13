import { ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import type { AuditService } from '../../audit/audit.service';
import { CommandOutcome } from '../../commands/command.types';
import type { AuthenticatedService } from '../../service-auth/service-principals';
import type { ConfigReader } from '../integration-config';
import type { IncomingMessage } from '../channels/incoming-message';
import {
  TelegramUpdateOutcome,
  type ProcessedMessage,
  type TelegramAdapter,
} from '../telegram/telegram.adapter';
import {
  type TelegramEnvelope,
  isEnvelopeFresh,
  isMessageRecent,
  signReply,
  verifyEnvelope,
} from '../telegram/telegram-envelope';
import { isAcceptableSigningKey } from '../telegram/telegram-n8n-settings';
import type { TelegramIngestDto, TelegramIngestResponseDto } from './telegram-ingest.dto';
import { InboundEventStatus } from './telegram-inbound-event.entity';
import type { TelegramInboundEventsRepository } from './telegram-inbound-events.repository';

export const INGEST_SIGNING_KEY = 'TELEGRAM_INGEST_SIGNING_KEY';
const CHANNEL = 'telegram';

/** Texto padrao quando a avaliacao em si quebra. Nada de detalhe interno. */
export const INGEST_FAILURE_REPLY =
  'Nao foi possivel executar o comando agora. Tente novamente mais tarde.';

/** Desfecho tecnico de uma mensagem, em vocabulario fechado. */
export type IngestOutcome =
  'EXECUTED' | 'DENIED' | 'UNLINKED' | 'UNKNOWN_COMMAND' | 'FAILED' | 'DUPLICATE';

/**
 * Quanto a autorizacao foi exercida. `IDENTIFICADO`: a pessoa e conhecida, mas a
 * mensagem nao chegou a um comando valido (nenhuma decisao de permissao houve).
 */
type Authorization = 'AUTORIZADO' | 'NEGADO' | 'NAO_VINCULADO' | 'IDENTIFICADO' | 'N/A';

interface Classified {
  readonly outcome: Exclude<IngestOutcome, 'DUPLICATE'>;
  readonly authorization: Authorization;
}

/**
 * Entrada de mensagens do Telegram pelo canal de servico (n8n -> backend).
 *
 * E a AUTORIDADE do fluxo. Quem chama - o n8n - e autenticado como SERVICO, mas
 * isso so abre a porta; o que decide e esta ordem, sem pular etapa:
 *
 * 1. a ASSINATURA do envelope confere (so o transporte, dentro do backend, a
 *    produz) e o envelope e RECENTE. Falhou: recusa e auditoria, sem executar;
 * 2. a mensagem e RESERVADA no banco (`telegram_inbound_events`, indice unico).
 *    Ja reservada: e duplicada, nada executa, nao ha resposta;
 * 3. a identidade vem de `envelope.userId` - ja autenticado pela assinatura - e
 *    passa pelo resolvedor de vinculos (usuario ATIVO, relido do banco);
 * 4. o Command Engine aplica o RBAC DESSA PESSOA. O servico nunca e o ator e nao
 *    tem privilegio financeiro;
 * 5. a resposta volta ASSINADA e amarrada ao envelope.
 *
 * O n8n nao tem como dizer quem e o usuario: nao ha campo para isso e, mesmo que
 * houvesse, a assinatura nao conferiria. O vinculo (`/vincular`) nao passa por
 * aqui - o codigo e uma prova de posse e nao deve trafegar pelo n8n.
 *
 * Auditoria: uma linha por mensagem, sem texto, sem resposta e sem dado de negocio.
 * O `principal` e a credencial de SERVICO ficam em campos proprios; o `usuarioId`
 * e a PESSOA.
 */
export class TelegramIngestService {
  private readonly logger = new Logger(TelegramIngestService.name);

  constructor(
    private readonly config: ConfigReader,
    private readonly events: TelegramInboundEventsRepository,
    private readonly adapter: TelegramAdapter,
    private readonly audit: AuditService,
    private readonly now: () => number = (): number => Date.now(),
  ) {}

  async ingest(
    input: TelegramIngestDto,
    service: AuthenticatedService,
  ): Promise<TelegramIngestResponseDto> {
    const key = this.signingKey();
    if (key === null) {
      // Fail-closed: sem chave nao ha como autenticar envelope nenhum.
      throw new ServiceUnavailableException('Entrada do Telegram nao configurada');
    }

    const envelope: TelegramEnvelope = input.envelope;

    // 1. autenticidade
    if (!verifyEnvelope(envelope, input.signature, key)) {
      return this.reject(service, 'assinatura');
    }
    if (!isEnvelopeFresh(envelope, this.now())) {
      return this.reject(service, 'expirado');
    }
    // A MENSAGEM tambem tem prazo: sem isto, um update antigo reentregue pelo Telegram
    // ganharia um envelope novo e passaria na janela de 5 minutos do envelope.
    if (!isMessageRecent(envelope, this.now())) {
      return this.reject(service, 'antigo');
    }
    // Conversa privada: quem recebe a resposta e quem pediu. O transporte so assina
    // assim; divergencia (mesmo assinada) e tratada como invalida.
    if (envelope.chatId !== envelope.userId) {
      return this.reject(service, 'inconsistente');
    }

    // 2. idempotencia persistente
    const event = await this.events.claim(CHANNEL, envelope.botId, envelope.updateId);
    if (event === null) {
      return this.duplicate(envelope, service);
    }

    // 3-4. identidade + autorizacao + comando (o mesmo caminho do polling direto)
    let processed: ProcessedMessage | null = null;
    try {
      processed = await this.adapter.processMessage(toIncomingMessage(envelope), {
        allowLinking: false,
      });
    } catch (error) {
      // `processMessage` nao lanca por contrato; se lancar, falha fechada.
      this.logger.error(`Telegram ingest: falha ao avaliar a mensagem (${errorName(error)})`);
    }

    const classified: Classified =
      processed === null ? { outcome: 'FAILED', authorization: 'N/A' } : classify(processed);
    const reply = processed?.reply ?? INGEST_FAILURE_REPLY;
    const userId = processed?.userId ?? null;

    await this.events.finish(
      event.id,
      classified.outcome === 'FAILED' ? InboundEventStatus.Falhou : InboundEventStatus.Concluido,
      classified.outcome,
      userId,
    );
    await this.record(service, {
      resultado: classified.outcome,
      autorizacao: classified.authorization,
      comando: processed?.command ?? null,
      correlacao: event.id,
      updateId: envelope.updateId,
      usuarioId: userId,
    });
    this.logger.log(`Telegram ingest: ${classified.outcome} (correlacao ${event.id})`);

    // 5. resposta assinada
    return {
      correlationId: event.id,
      outcome: classified.outcome,
      duplicate: false,
      reply,
      signature: signReply(envelope, classified.outcome, reply, key),
    };
  }

  private signingKey(): string | null {
    const raw = this.config.get<unknown>(INGEST_SIGNING_KEY);
    return typeof raw === 'string' && isAcceptableSigningKey(raw) ? raw : null;
  }

  private async duplicate(
    envelope: TelegramEnvelope,
    service: AuthenticatedService,
  ): Promise<TelegramIngestResponseDto> {
    const original = await this.events.findByUpdate(CHANNEL, envelope.botId, envelope.updateId);
    const correlationId = original?.id ?? 'desconhecido';
    await this.record(service, {
      resultado: 'DUPLICATE',
      autorizacao: 'N/A',
      comando: null,
      correlacao: correlationId,
      updateId: envelope.updateId,
      usuarioId: null,
    });
    this.logger.warn(`Telegram ingest: entrega duplicada (correlacao ${correlationId})`);
    return { correlationId, outcome: 'DUPLICATE', duplicate: true, reply: null, signature: null };
  }

  /**
   * Envelope que nao e confiavel: auditado e recusado com 403. Nao ha `usuarioId`:
   * o id do remetente de um envelope nao autenticado e dado do atacante.
   */
  private async reject(service: AuthenticatedService, motivo: string): Promise<never> {
    await this.record(service, {
      resultado: 'ENVELOPE_REJECTED',
      autorizacao: 'N/A',
      comando: null,
      motivo,
      usuarioId: null,
    });
    this.logger.warn(`Telegram ingest: envelope rejeitado (${motivo})`);
    throw new ForbiddenException('Envelope rejeitado');
  }

  private async record(
    service: AuthenticatedService,
    details: {
      readonly resultado: string;
      readonly autorizacao: Authorization;
      readonly comando: string | null;
      readonly correlacao?: string;
      readonly updateId?: number;
      readonly motivo?: string;
      readonly usuarioId: string | null;
    },
  ): Promise<void> {
    const { usuarioId, ...metadados } = details;
    await this.audit.record({
      ...(usuarioId === null ? {} : { usuarioId }),
      acao: AuditAction.ChannelMessage,
      modulo: AuditModuleName.Channels,
      descricao: `Mensagem do Telegram: ${details.resultado}`,
      metadados: {
        canal: CHANNEL,
        ...metadados,
        // QUEM entregou. Chaves sem as palavras que a higienizacao da auditoria remove.
        principal: service.principal,
        servicoId: service.credentialId,
      },
    });
  }
}

function toIncomingMessage(envelope: TelegramEnvelope): IncomingMessage {
  return {
    channel: CHANNEL,
    conversationId: envelope.chatId,
    sender: { channel: CHANNEL, externalId: envelope.userId },
    text: envelope.text,
    receivedAt: new Date(envelope.sentAt * 1000),
  };
}

function classify(processed: ProcessedMessage): Classified {
  if (processed.outcome === TelegramUpdateOutcome.Unlinked) {
    return { outcome: 'UNLINKED', authorization: 'NAO_VINCULADO' };
  }
  if (processed.outcome !== TelegramUpdateOutcome.Executed) {
    // Vinculo nao passa por aqui (`allowLinking: false`): qualquer outra coisa e anomalia.
    return { outcome: 'FAILED', authorization: 'N/A' };
  }
  switch (processed.commandOutcome) {
    case CommandOutcome.Ok:
      return { outcome: 'EXECUTED', authorization: 'AUTORIZADO' };
    case CommandOutcome.PermissionDenied:
      return { outcome: 'DENIED', authorization: 'NEGADO' };
    case CommandOutcome.HandlerError:
      return { outcome: 'FAILED', authorization: 'AUTORIZADO' };
    default:
      // Vazia, texto comum, malformada ou desconhecida: a pessoa e conhecida, mas
      // nenhuma decisao de permissao foi tomada.
      return { outcome: 'UNKNOWN_COMMAND', authorization: 'IDENTIFICADO' };
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
