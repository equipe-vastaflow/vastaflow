import type { CommandResult } from '../../commands/command.types';

/** Tamanho maximo do texto de uma mensagem na Bot API. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

const TRUNCATION_MARK = '\n[...]';

/**
 * Resposta a um remetente sem vinculo com um usuario interno. Nao revela nada
 * do sistema: nem quais comandos existem, nem se o id dele e conhecido.
 */
export const TELEGRAM_UNLINKED_REPLY =
  'Esta conta do Telegram nao esta vinculada a um usuario do VastaFlow. ' +
  'Nenhum comando pode ser executado por aqui.';

/**
 * Converte o `CommandResult` no texto enviado ao Telegram.
 *
 * O texto e o `reply` do proprio Command Engine, para todos os desfechos:
 * sucesso, comando desconhecido, sem permissao, texto que nao e comando e
 * falha do handler. O router ja garante que esse texto e seguro (sem stack
 * trace nem detalhe interno), e reescreve-lo aqui criaria um segundo
 * vocabulario. A conversa e sempre privada, entao responder a um texto que nao
 * e comando e o comportamento que o router ja define.
 *
 * O que e do Telegram fica aqui: o limite de tamanho da mensagem.
 */
export function toTelegramText(result: CommandResult): string {
  if (result.reply.length <= TELEGRAM_MESSAGE_LIMIT) {
    return result.reply;
  }
  return result.reply.slice(0, TELEGRAM_MESSAGE_LIMIT - TRUNCATION_MARK.length) + TRUNCATION_MARK;
}
