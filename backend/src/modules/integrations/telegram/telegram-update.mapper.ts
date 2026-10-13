import type { IncomingMessage } from '../channels/incoming-message';
import { ENVELOPE_PLATFORM, ENVELOPE_VERSION, type TelegramEnvelope } from './telegram-envelope';
import { isRecord } from './telegram-json';

export const TELEGRAM_CHANNEL = 'telegram';

/**
 * Campos que marcam uma mensagem como ENCAMINHADA (ou enviada por outro bot). Uma
 * mensagem assim nao foi digitada por quem a enviou ao bot: o texto veio de outra
 * pessoa ou de outro lugar, e nunca vira comando. Cobre o formato atual
 * (`forward_origin`) e os campos legados que clientes antigos ainda enviam.
 */
const FORWARDED_MARKERS = [
  'forward_origin',
  'forward_from',
  'forward_from_chat',
  'forward_from_message_id',
  'forward_signature',
  'forward_sender_name',
  'forward_date',
  'is_automatic_forward',
  'via_bot',
] as const;

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
 * - DIGITADA por ela: mensagem encaminhada (ou enviada via outro bot) e ignorada;
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
  const message = raw.message;
  const { chat, from, text, date } = message;

  if (FORWARDED_MARKERS.some((marker) => marker in message)) {
    return null;
  }

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

/** Limite de texto da Bot API: acima disso o update nao e de uma mensagem real. */
const MAX_TEXT_LENGTH = 4096;

/**
 * Reduz um update ao envelope que o transporte assina e entrega ao n8n - ou `null`
 * se ele nao for algo que o VastaFlow processa.
 *
 * Reaproveita `toIncomingMessage`: as MESMAS regras de sempre (texto, conversa
 * privada 1:1, remetente nao-bot). Acrescenta so os ids estaveis necessarios a
 * idempotencia (`update_id`, `message_id`) e o id do bot. Nome, username, idioma,
 * telefone e o resto do payload ficam de fora - nao chegam ao n8n.
 */
export function toTelegramEnvelope(
  raw: unknown,
  botId: string,
  issuedAt: number,
): TelegramEnvelope | null {
  const message = toIncomingMessage(raw);
  const updateId = readUpdateId(raw);
  if (!message || updateId === null || updateId < 0 || !isRecord(raw) || !isRecord(raw.message)) {
    return null;
  }
  const { message_id: messageId, date } = raw.message;
  if (
    !Number.isSafeInteger(messageId) ||
    (messageId as number) < 0 ||
    !Number.isSafeInteger(date)
  ) {
    return null;
  }
  if (message.text.length < 1 || message.text.length > MAX_TEXT_LENGTH) {
    return null;
  }
  return {
    version: ENVELOPE_VERSION,
    platform: ENVELOPE_PLATFORM,
    botId,
    updateId,
    messageId: messageId as number,
    chatId: message.conversationId,
    userId: message.sender.externalId,
    chatType: 'private',
    text: message.text,
    sentAt: date as number,
    issuedAt,
  };
}
