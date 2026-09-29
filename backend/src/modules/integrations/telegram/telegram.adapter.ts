import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CommandRouter } from '../../commands/command-router.service';
import { CommandChannel } from '../../commands/command.types';
import {
  CHANNEL_IDENTITY_RESOLVER,
  type ChannelIdentityResolver,
} from '../channels/channel-identity';
import type { IncomingMessage } from '../channels/incoming-message';
import { TelegramApiClient, TelegramApiError } from './telegram-api.client';
import { TELEGRAM_UNLINKED_REPLY, toTelegramText } from './telegram-reply';
import { toIncomingMessage } from './telegram-update.mapper';

/** O que aconteceu com um update. Usado em log e nos testes - nunca sai do processo. */
export enum TelegramUpdateOutcome {
  /** Nao e mensagem de texto em chat privado de uma pessoa: nada a fazer. */
  Ignored = 'IGNORED',
  /** Remetente sem vinculo: respondido com aviso, sem executar comando. */
  Unlinked = 'UNLINKED',
  /** Passou pelo Command Engine e a resposta foi enviada. */
  Executed = 'EXECUTED',
  /** A resposta nao pode ser enviada ao Telegram. */
  ReplyFailed = 'REPLY_FAILED',
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
  ) {}

  async handleUpdate(raw: unknown): Promise<TelegramUpdateOutcome> {
    const message = toIncomingMessage(raw);
    if (!message) {
      return TelegramUpdateOutcome.Ignored;
    }

    const user = await this.resolve(message);
    let text: string;
    let outcome: TelegramUpdateOutcome;

    if (user === null) {
      text = TELEGRAM_UNLINKED_REPLY;
      outcome = TelegramUpdateOutcome.Unlinked;
    } else {
      // `execute` nunca lanca: todo desfecho vira `CommandResult`.
      const result = await this.router.execute({
        user,
        conversationId: message.conversationId,
        channel: CommandChannel.Telegram,
        text: message.text,
      });
      text = toTelegramText(result);
      outcome = TelegramUpdateOutcome.Executed;
    }

    try {
      await this.client.sendMessage(message.conversationId, text);
    } catch (error) {
      this.logger.warn(`Telegram: resposta nao enviada (${describeFailure(error)})`);
      return TelegramUpdateOutcome.ReplyFailed;
    }

    // Sem texto da mensagem, sem id do remetente e sem a resposta: so o desfecho.
    this.logger.debug(`Telegram: mensagem processada (${outcome})`);
    return outcome;
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
