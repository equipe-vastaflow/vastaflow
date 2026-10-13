import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CommandRouter } from '../../commands/command-router.service';
import { parseCommand } from '../../commands/command-parser';
import { CommandChannel, CommandOutcome } from '../../commands/command.types';
import {
  CHANNEL_IDENTITY_RESOLVER,
  type ChannelIdentityResolver,
} from '../channels/channel-identity';
import {
  CHANNEL_LINK_CONFIRMER,
  type ChannelLinkConfirmer,
  LinkConfirmationOutcome,
} from '../channels/channel-link';
import type { IncomingMessage } from '../channels/incoming-message';
import { TelegramApiClient, TelegramApiError } from './telegram-api.client';
import { linkConfirmationReply, TELEGRAM_UNLINKED_REPLY, toTelegramText } from './telegram-reply';
import { toIncomingMessage } from './telegram-update.mapper';

/** O que aconteceu com um update. Usado em log e nos testes - nunca sai do processo. */
export enum TelegramUpdateOutcome {
  /** Nao e mensagem de texto em chat privado de uma pessoa: nada a fazer. */
  Ignored = 'IGNORED',
  /** Remetente sem vinculo: respondido com aviso, sem executar comando. */
  Unlinked = 'UNLINKED',
  /** Passou pelo Command Engine e a resposta foi enviada. */
  Executed = 'EXECUTED',
  /** `/vincular <codigo>` confirmado: o remetente passou a ter vinculo ativo. */
  LinkConfirmed = 'LINK_CONFIRMED',
  /** `/vincular` recusado (codigo invalido/expirado/usado) ou conta ja vinculada. */
  LinkRejected = 'LINK_REJECTED',
  /** A resposta nao pode ser enviada ao Telegram. */
  ReplyFailed = 'REPLY_FAILED',
  /** Modo `n8n`: o envelope foi avaliado pelo backend e a resposta enviada. */
  Relayed = 'RELAYED',
  /** Modo `n8n`: o n8n/backend nao respondeu direito; foi enviado o aviso padrao. */
  RelayFailed = 'RELAY_FAILED',
  /** Modo `n8n`: o backend ja tinha processado este update; nada foi reenviado. */
  Duplicate = 'DUPLICATE',
}

/**
 * O que `processMessage` decidiu - SEM enviar nada. Usado por quem recebe a mensagem
 * por outro caminho (ver `telegram-ingest`) e nao por `getUpdates`.
 */
export interface ProcessedMessage {
  /** Nunca `Ignored` nem `ReplyFailed`: esses dois so existem no envio. */
  readonly outcome:
    | TelegramUpdateOutcome.Unlinked
    | TelegramUpdateOutcome.Executed
    | TelegramUpdateOutcome.LinkConfirmed
    | TelegramUpdateOutcome.LinkRejected;
  /** Texto para o usuario, ja no limite do Telegram. */
  readonly reply: string;
  /** Usuario interno resolvido, ou `null` (nao vinculado / vinculo recusado). */
  readonly userId: string | null;
  /** Desfecho do Command Engine, quando um comando chegou a ser avaliado. */
  readonly commandOutcome: CommandOutcome | null;
  /**
   * Nome do comando - SO quando e um comando REGISTRADO (nunca texto livre nem
   * argumentos). Seguro para auditoria.
   */
  readonly command: string | null;
}

/** Opcoes de `processMessage`. */
export interface ProcessMessageOptions {
  /**
   * Aceita `/vincular <codigo>` (padrao: sim). O ingest passa `false`: o codigo de
   * vinculo e uma prova de posse e nunca deve trafegar pelo n8n; quem o trata e
   * o proprio transporte.
   */
  readonly allowLinking?: boolean;
}

/**
 * Adaptador do canal Telegram: a unica peca que conhece os dois lados.
 *
 * ```
 * update do Telegram -> IncomingMessage -> identidade -> CommandContext
 *   -> CommandRouter -> CommandResult -> texto -> sendMessage
 * ```
 *
 * O Command Engine recebe o `CommandContext` de sempre e nao sabe que a
 * mensagem veio do Telegram - o canal e so o rotulo `CommandChannel.Telegram`.
 *
 * VINCULACAO: antes de tudo, a mensagem e oferecida ao `ChannelLinkConfirmer`.
 * Se for `/vincular <codigo>`, e tratada la (prova de posse da conta) e nunca
 * chega ao motor - quem confirma ainda nao tem usuario, e o motor exige um.
 * Qualquer outra mensagem segue o fluxo normal. O adapter nao ve banco nem
 * codigo: so o desfecho.
 *
 * IDENTIDADE: o usuario interno sai EXCLUSIVAMENTE do `ChannelIdentityResolver`,
 * a partir do remetente no Telegram. Nada do texto ou do payload escolhe o
 * usuario. Sem vinculo (`null`), o comando nao e executado: nenhum perfil e
 * presumido, e o RBAC nunca e avaliado para alguem que o sistema nao conhece.
 *
 * Nunca lanca excecao: o polling depende disso para seguir com os proximos
 * updates.
 */
@Injectable()
export class TelegramAdapter {
  private readonly logger = new Logger(TelegramAdapter.name);

  constructor(
    private readonly router: CommandRouter,
    private readonly client: TelegramApiClient,
    @Inject(CHANNEL_IDENTITY_RESOLVER) private readonly identities: ChannelIdentityResolver,
    @Inject(CHANNEL_LINK_CONFIRMER) private readonly linking: ChannelLinkConfirmer,
  ) {}

  async handleUpdate(raw: unknown): Promise<TelegramUpdateOutcome> {
    const message = toIncomingMessage(raw);
    if (!message) {
      return TelegramUpdateOutcome.Ignored;
    }

    const { reply, outcome } = await this.processMessage(message);

    try {
      await this.client.sendMessage(message.conversationId, reply);
    } catch (error) {
      this.logger.warn(`Telegram: resposta nao enviada (${describeFailure(error)})`);
      return TelegramUpdateOutcome.ReplyFailed;
    }

    // Sem texto da mensagem, sem id do remetente e sem a resposta: so o desfecho.
    this.logger.debug(`Telegram: mensagem processada (${outcome})`);
    return outcome;
  }

  /**
   * Decide o que responder a uma mensagem JA reduzida a `IncomingMessage` - sem
   * enviar. E o mesmo caminho do `handleUpdate`, extraido para ser reutilizado:
   * confirmar vinculo -> resolver a identidade -> Command Engine.
   *
   * Nunca lanca: falha do confirmador vira recusa e falha do resolvedor vira "nao
   * vinculado". A identidade vem SOMENTE de `message.sender`.
   */
  async processMessage(
    message: IncomingMessage,
    options: ProcessMessageOptions = {},
  ): Promise<ProcessedMessage> {
    const confirmation =
      options.allowLinking === false
        ? LinkConfirmationOutcome.NotAttempted
        : await this.confirm(message);

    if (confirmation !== LinkConfirmationOutcome.NotAttempted) {
      return {
        outcome:
          confirmation === LinkConfirmationOutcome.Confirmed
            ? TelegramUpdateOutcome.LinkConfirmed
            : TelegramUpdateOutcome.LinkRejected,
        reply: linkConfirmationReply(confirmation),
        userId: null,
        commandOutcome: null,
        command: null,
      };
    }

    const user = await this.resolve(message);
    if (user === null) {
      return {
        outcome: TelegramUpdateOutcome.Unlinked,
        reply: TELEGRAM_UNLINKED_REPLY,
        userId: null,
        commandOutcome: null,
        command: null,
      };
    }

    // `execute` nunca lanca: todo desfecho vira `CommandResult`.
    const result = await this.router.execute({
      user,
      conversationId: message.conversationId,
      channel: CommandChannel.Telegram,
      text: message.text,
    });
    return {
      outcome: TelegramUpdateOutcome.Executed,
      reply: toTelegramText(result),
      userId: user.id,
      commandOutcome: result.outcome,
      command: registeredCommandName(message.text, result.outcome),
    };
  }

  /** Falha do confirmador conta como recusa - nunca como vinculo criado. */
  private async confirm(message: IncomingMessage): Promise<LinkConfirmationOutcome> {
    try {
      return await this.linking.tryConfirm(message.sender, message.text);
    } catch (error) {
      this.logger.warn(`Telegram: falha ao confirmar vinculo (${describeFailure(error)})`);
      return LinkConfirmationOutcome.Rejected;
    }
  }

  /** Falha do resolvedor conta como "nao vinculado" - nunca como acesso liberado. */
  private async resolve(message: IncomingMessage): Promise<AuthenticatedUser | null> {
    try {
      return await this.identities.resolve(message.sender);
    } catch (error) {
      this.logger.warn(`Telegram: falha ao resolver a identidade (${describeFailure(error)})`);
      return null;
    }
  }
}

/**
 * Descricao segura de uma falha para log. De `TelegramApiError` usa a propria
 * mensagem, montada sem token nem URL; de qualquer outro erro, so o nome - a
 * mensagem de um erro desconhecido pode carregar qualquer coisa.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof TelegramApiError) {
    return error.message;
  }
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Nome do comando para auditoria: so quando o comando EXISTE e foi avaliado. Texto
 * livre, comando desconhecido ou malformado nunca viram nome - podem conter
 * qualquer coisa que o usuario digitou.
 */
function registeredCommandName(text: string, outcome: CommandOutcome): string | null {
  if (
    outcome !== CommandOutcome.Ok &&
    outcome !== CommandOutcome.PermissionDenied &&
    outcome !== CommandOutcome.HandlerError
  ) {
    return null;
  }
  const parsed = parseCommand(text);
  return parsed.kind === 'command' ? parsed.command.name : null;
}
