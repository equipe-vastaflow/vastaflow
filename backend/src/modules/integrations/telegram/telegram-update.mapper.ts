import type { IncomingMessage } from '../channels/incoming-message';
import { isRecord } from './telegram-json';

export const TELEGRAM_CHANNEL = 'telegram';

/**
 * `update_id` do update cru, ou `null` se ausente/invalido.
 *
 * O polling precisa dele para avancar o `offset` mesmo quando o update em si e
 * ignorado - senao o mesmo update voltaria em toda consulta.
 */
export function readUpdateId(raw: unknown): number | null {
  return isRecord(raw) && Number.isSafeInteger(raw.update_id) ? (raw.update_id as number) : null;
}

/**
 * Reduz um update da Bot API a uma `IncomingMessage` neutra - ou `null` se ele
 * nao for algo que o VastaFlow processa.
 *
 * Aceita somente:
 * - `message` (mensagem nova; edicoes e outros tipos de update ficam de fora);
 * - com `text` (fotos, audios, stickers etc. sao ignorados);
 * - de uma pessoa: remetente bot e ignorado, o que tambem evita loop entre bots;
 * - em CONVERSA 1:1 - regra abaixo.
 *
 * REGRA ARQUITETURAL TEMPORARIA: so conversa 1:1 (`chat.type === 'private'` e o
 * chat e o proprio remetente). Grupo, supergrupo e canal ficam fora do fluxo.
 * NAO e uma decisao de produto - essa decisao ainda nao existe. E uma limitacao
 * tecnica do modelo atual, ate haver identidade e autorizacao para grupos:
 *
 * 1. o RBAC do Command Engine autoriza QUEM PEDE (`context.user`), mas num grupo
 *    a resposta e entregue a TODOS os membros - inclusive a quem nao tem a
 *    permissao que o comando exigiu. Nao existe autorizacao da audiencia;
 * 2. o `CommandContext` tem um so `conversationId` (onde responder) e um so
 *    `user`. Isso so e coerente quando os dois sao a mesma pessoa;
 * 3. em grupo o Telegram costuma enviar comandos como `/ajuda@NomeDoBot`, que o
 *    parser atual classifica como malformado;
 * 4. sem vinculo, o bot responderia "nao vinculado" em grupo a cada mensagem.
 *
 * Canal nem chega: posts de canal vem como `channel_post` (fora de
 * `allowed_updates`) e nao tem remetente pessoa.
 *
 * Copia so os campos necessarios. Nome, username, idioma, telefone e o resto
 * do payload nunca chegam ao Command Engine.
 */
export function toIncomingMessage(raw: unknown): IncomingMessage | null {
  if (!isRecord(raw) || !isRecord(raw.message)) {
    return null;
  }
  const { chat, from, text, date } = raw.message;

  if (!isRecord(chat) || !Number.isSafeInteger(chat.id) || chat.type !== 'private') {
    return null;
  }
  if (!isRecord(from) || !Number.isSafeInteger(from.id) || from.is_bot === true) {
    return null;
  }
  // Regra 1:1: quem recebe a resposta e quem pediu. Em chat privado o Telegram
  // usa o id do usuario como id do chat; qualquer divergencia fica de fora.
  if (chat.id !== from.id) {
    return null;
  }
  if (typeof text !== 'string' || !Number.isSafeInteger(date)) {
    return null;
  }

  return {
    channel: TELEGRAM_CHANNEL,
    conversationId: String(chat.id),
    sender: { channel: TELEGRAM_CHANNEL, externalId: String(from.id) },
    text,
    // `date` da Bot API e Unix time, em segundos.
    receivedAt: new Date((date as number) * 1000),
  };
}
