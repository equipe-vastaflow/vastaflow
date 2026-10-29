import { Logger } from '@nestjs/common';
import { SlidingWindowLimiter } from '../../../common/rate-limit/sliding-window-limiter';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { parseCommand } from '../../commands/command-parser';
import type { CommandRouter } from '../../commands/command-router.service';
import { CommandChannel, CommandOutcome } from '../../commands/command.types';
import type { ChannelIdentityResolver } from '../channels/channel-identity';
import { type ChannelLinkConfirmer, LinkConfirmationOutcome } from '../channels/channel-link';
import { MESSAGE_MAX_AGE_MS } from '../telegram/telegram-envelope';
import { WhatsappApiError, type WhatsappSender } from './whatsapp-api.client';
import { WhatsappEventStatus } from './whatsapp-inbound-event.entity';
import type { WhatsappInboundEventsRepository } from './whatsapp-inbound-events.repository';
import { WHATSAPP_TEXT_MAX, type InboundWhatsappText } from './whatsapp-payload';

const CHANNEL = 'whatsapp';

/** Textos FIXOS desta camada (nunca algo vindo de fora). */
export const WHATSAPP_REPLIES = {
  unlinked:
    'Este numero de WhatsApp nao esta vinculado a um usuario do VastaFlow. Para vincular, peca um codigo ao administrador e envie aqui: /vincular CODIGO',
  linked: 'Vinculo confirmado. Envie /ajuda para ver os comandos disponiveis.',
  linkRejected: 'Codigo invalido, expirado ou ja usado. Peca um novo codigo ao administrador.',
  alreadyLinked: 'Este numero ja esta vinculado a um usuario.',
  rateLimited:
    'Voce enviou mensagens demais em pouco tempo. Aguarde cerca de um minuto e tente de novo.',
  failure: 'Nao foi possivel executar o comando agora. Tente novamente mais tarde.',
} as const;

/** Mensagens por minuto por remetente (numero). O excesso e descartado sem executar nada. */
export const WHATSAPP_USER_RATE_PER_MINUTE = 10;

export type WhatsappOutcome =
  | 'IGNORED'
  | 'STALE'
  | 'DUPLICATE'
  | 'RATE_LIMITED'
  | 'LINK_CONFIRMED'
  | 'LINK_REJECTED'
  | 'UNLINKED'
  | 'EXECUTED'
  | 'DENIED'
  | 'UNKNOWN_COMMAND'
  | 'FAILED';

/**
 * Uma mensagem de texto do WhatsApp, do webhook ate a resposta.
 *
 * Ordem (cada etapa so existe depois da anterior):
 * 1. e do NOSSO numero? (outro `phone_number_id` e ignorado);
 * 2. e recente? (mais de 10 min e descartada sem executar: a Meta reentrega por dias);
 * 3. RESERVA no banco (indice unico): ja vista = `DUPLICATE`, nada executa;
 * 4. limite por remetente (10/min): excesso descartado; o aviso (uma vez por janela) so sai com
 *    `replyToUnlinked`;
 * 5. `/vincular <codigo>`: prova de posse do numero (o codigo nao e logado nem auditado);
 * 6. identidade: o `wa_id` deve estar vinculado a usuario ATIVO (sem vinculo = `UNLINKED`, nada roda e,
 *    por padrao, NADA e respondido: ver `replyToUnlinked`);
 * 7. RBAC do Command Engine para ESSA pessoa;
 * 8. auditoria (`CHANNEL_MESSAGE`, sem texto/numero) e resposta pela Cloud API.
 *
 * Nunca lanca. At-most-once, como no Telegram: se cair depois da reserva, a mensagem NAO e
 * reexecutada. Sem logar texto, resposta, numero ou token.
 */
export class WhatsappMessageProcessor {
  private readonly logger = new Logger(WhatsappMessageProcessor.name);
  private readonly limiter = new SlidingWindowLimiter(WHATSAPP_USER_RATE_PER_MINUTE, 60_000);

  constructor(
    private readonly phoneNumberId: () => string,
    private readonly events: WhatsappInboundEventsRepository,
    private readonly identities: ChannelIdentityResolver,
    private readonly linking: ChannelLinkConfirmer,
    private readonly router: CommandRouter,
    private readonly audit: AuditService,
    private readonly sender: WhatsappSender,
    private readonly now: () => number = (): number => Date.now(),
    /**
     * Responder a quem NAO esta vinculado (e o aviso de limite)? PADRAO NAO. Num numero que tambem atende
     * clientes (coexistencia com o app WhatsApp Business) qualquer cliente que escrevesse receberia uma
     * resposta automatica do bot. Mesmo num numero so do bot, nao ha por que responder a desconhecidos.
     * `/vincular <codigo>` (comando explicito) SEMPRE recebe resposta.
     */
    private readonly replyToUnlinked: () => boolean = (): boolean => false,
  ) {}

  async process(message: InboundWhatsappText): Promise<WhatsappOutcome> {
    try {
      return await this.run(message);
    } catch (error) {
      this.logger.error(
        `WhatsApp: falha ao processar (${error instanceof Error ? error.name : typeof error})`,
      );
      return 'FAILED';
    }
  }

  private async run(message: InboundWhatsappText): Promise<WhatsappOutcome> {
    if (message.phoneNumberId !== this.phoneNumberId()) {
      return 'IGNORED';
    }
    if (this.now() - message.timestamp * 1000 > MESSAGE_MAX_AGE_MS) {
      this.logger.warn('WhatsApp: mensagem antiga descartada (nao executada)');
      return 'STALE';
    }

    const event = await this.events.claim(message.phoneNumberId, message.messageId);
    if (event === null) {
      this.logger.warn('WhatsApp: entrega duplicada ignorada');
      return 'DUPLICATE';
    }

    const decision = this.limiter.take(message.from);
    if (!decision.allowed) {
      await this.events.finish(event.id, WhatsappEventStatus.Concluido, 'RATE_LIMITED', null);
      this.logger.warn('WhatsApp: limite por remetente excedido; mensagem descartada');
      if (decision.firstRejection && this.replyToUnlinked()) {
        await this.reply(message.from, WHATSAPP_REPLIES.rateLimited);
      }
      return 'RATE_LIMITED';
    }

    const identity = { channel: CHANNEL, externalId: message.from };

    const link = await this.confirmLink(identity, message.text);
    if (link !== LinkConfirmationOutcome.NotAttempted) {
      const outcome =
        link === LinkConfirmationOutcome.Confirmed ? 'LINK_CONFIRMED' : 'LINK_REJECTED';
      await this.events.finish(event.id, WhatsappEventStatus.Concluido, outcome, null);
      await this.reply(message.from, linkReply(link));
      return outcome;
    }

    const user = await this.resolve(identity);
    if (user === null) {
      await this.finishAndAudit(event.id, 'UNLINKED', 'NAO_VINCULADO', null, null);
      if (this.replyToUnlinked()) {
        await this.reply(message.from, WHATSAPP_REPLIES.unlinked);
      }
      return 'UNLINKED';
    }

    const result = await this.router.execute({
      user,
      conversationId: message.from,
      channel: CommandChannel.Whatsapp,
      text: message.text,
    });
    const { outcome, authorization } = classify(result.outcome);
    await this.finishAndAudit(
      event.id,
      outcome,
      authorization,
      user.id,
      registeredName(message.text, result.outcome),
    );
    await this.reply(message.from, clamp(result.reply));
    return outcome;
  }

  private async confirmLink(
    identity: { channel: string; externalId: string },
    text: string,
  ): Promise<LinkConfirmationOutcome> {
    try {
      return await this.linking.tryConfirm(identity, text);
    } catch {
      // Falha do confirmador conta como recusa - nunca como vinculo criado.
      return LinkConfirmationOutcome.Rejected;
    }
  }

  private async resolve(identity: {
    channel: string;
    externalId: string;
  }): Promise<AuthenticatedUser | null> {
    try {
      return await this.identities.resolve(identity);
    } catch {
      // Falha do resolvedor conta como "nao vinculado" - nunca como acesso liberado.
      return null;
    }
  }

  private async finishAndAudit(
    eventId: string,
    outcome: Exclude<
      WhatsappOutcome,
      'IGNORED' | 'STALE' | 'DUPLICATE' | 'RATE_LIMITED' | 'LINK_CONFIRMED' | 'LINK_REJECTED'
    >,
    authorization: string,
    userId: string | null,
    command: string | null,
  ): Promise<void> {
    await this.events.finish(
      eventId,
      outcome === 'FAILED' ? WhatsappEventStatus.Falhou : WhatsappEventStatus.Concluido,
      outcome,
      userId,
    );
    await this.audit.record({
      ...(userId === null ? {} : { usuarioId: userId }),
      acao: AuditAction.ChannelMessage,
      modulo: AuditModuleName.Channels,
      descricao: `Mensagem do WhatsApp: ${outcome}`,
      metadados: {
        canal: CHANNEL,
        resultado: outcome,
        autorizacao: authorization,
        comando: command,
        correlacao: eventId,
        origem: 'webhook-meta',
      },
    });
  }

  private async reply(to: string, text: string): Promise<void> {
    try {
      await this.sender.sendText(to, text);
    } catch (error) {
      this.logger.warn(`WhatsApp: resposta nao enviada (${describeSendFailure(error)})`);
    }
  }
}

/**
 * Motivo do envio que falhou, so com valores numericos e a categoria fixa: `http, status 400,
 * codigo 10, subcodigo 33, tipo OAuthException`. Nunca mensagem da Meta, URL, token, destinatario ou texto.
 */
function describeSendFailure(error: unknown): string {
  if (!(error instanceof WhatsappApiError)) {
    return 'desconhecido';
  }
  const parts: string[] = [error.kind];
  if (error.httpStatus !== undefined) {
    parts.push(`status ${String(error.httpStatus)}`);
  }
  if (error.graphCode !== undefined) {
    parts.push(`codigo ${String(error.graphCode)}`);
  }
  if (error.graphSubcode !== undefined) {
    parts.push(`subcodigo ${String(error.graphSubcode)}`);
  }
  if (error.graphType !== undefined) {
    parts.push(`tipo ${error.graphType}`);
  }
  return parts.join(', ');
}

function linkReply(outcome: LinkConfirmationOutcome): string {
  switch (outcome) {
    case LinkConfirmationOutcome.Confirmed:
      return WHATSAPP_REPLIES.linked;
    case LinkConfirmationOutcome.AlreadyLinked:
      return WHATSAPP_REPLIES.alreadyLinked;
    default:
      return WHATSAPP_REPLIES.linkRejected;
  }
}

function classify(outcome: CommandOutcome): {
  outcome: 'EXECUTED' | 'DENIED' | 'UNKNOWN_COMMAND' | 'FAILED';
  authorization: string;
} {
  switch (outcome) {
    case CommandOutcome.Ok:
      return { outcome: 'EXECUTED', authorization: 'AUTORIZADO' };
    case CommandOutcome.PermissionDenied:
      return { outcome: 'DENIED', authorization: 'NEGADO' };
    case CommandOutcome.HandlerError:
      return { outcome: 'FAILED', authorization: 'AUTORIZADO' };
    default:
      return { outcome: 'UNKNOWN_COMMAND', authorization: 'IDENTIFICADO' };
  }
}

/** Nome do comando SO se foi REGISTRADO (nunca texto livre nem argumentos). */
function registeredName(text: string, outcome: CommandOutcome): string | null {
  const known =
    outcome === CommandOutcome.Ok ||
    outcome === CommandOutcome.PermissionDenied ||
    outcome === CommandOutcome.HandlerError;
  const parsed = parseCommand(text);
  return known && parsed.kind === 'command' ? parsed.command.name : null;
}

function clamp(reply: string): string {
  return reply.length <= WHATSAPP_TEXT_MAX ? reply : `${reply.slice(0, WHATSAPP_TEXT_MAX - 3)}...`;
}
