import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Envelope assinado entre o TRANSPORTE do Telegram e o backend, com o n8n no meio.
 *
 * ```
 * Telegram -> transporte (assina) -> n8n (so repassa) -> backend (verifica) -> comando
 * backend (assina a resposta) -> n8n (so repassa) -> transporte (verifica) -> Telegram
 * ```
 *
 * POR QUE ASSINAR. O n8n e um orquestrador: roda workflows editaveis num editor
 * com login, guarda credenciais e e um alvo natural. Se o backend acreditasse no
 * que o n8n diz sobre QUEM mandou a mensagem, comprometer o n8n (ou a credencial
 * de servico dele) seria o mesmo que poder falar como qualquer usuario vinculado.
 * Com o envelope assinado por uma chave que SO o backend conhece:
 *
 * - o n8n nao consegue inventar nem trocar o remetente, o chat, o texto nem o
 *   horario: a assinatura deixaria de conferir;
 * - o n8n nao consegue alterar a resposta devolvida ao usuario nem redireciona-la
 *   para outro chat: a resposta tambem e assinada e amarrada ao envelope;
 * - o que o n8n AINDA consegue: descartar mensagens (disponibilidade) e reenviar
 *   um envelope legitimo ja visto (repeticao) - barrado pela idempotencia
 *   persistente e pela validade curta do envelope.
 *
 * O que NAO resolve: comprometimento do proprio backend ou da chave de
 * assinatura, e conta do Telegram de uma pessoa tomada por outra (a defesa ai e
 * revogar o vinculo). A chave nunca sai do backend.
 *
 * Este arquivo e puro: so `node:crypto`, sem rede, sem Nest, sem log.
 */

export const ENVELOPE_VERSION = 'v1';
export const ENVELOPE_PLATFORM = 'telegram';

/** Um envelope com mais de 5 minutos e recusado: janela curta contra repeticao. */
export const ENVELOPE_MAX_AGE_MS = 5 * 60 * 1000;
/** Tolerancia a relogios levemente adiantados entre transporte e backend. */
export const ENVELOPE_MAX_FUTURE_MS = 60 * 1000;

/**
 * Idade maxima da MENSAGEM (`message.date` do Telegram). Depois de uma queda, o
 * Telegram reentrega por ate 24 h os updates nao confirmados; executar um comando de
 * horas atras seria surpresa (e, com a retencao da idempotencia, risco). Acima disto
 * a mensagem e descartada sem executar e sem responder. Compromisso: quem mandou
 * durante uma queda longa precisa reenviar.
 */
export const MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;

/** Tamanho minimo da chave de assinatura (caracteres). 32+ aleatorios = 128+ bits. */
export const SIGNING_KEY_MIN_LENGTH = 32;

const ENVELOPE_DOMAIN = 'vastaflow.telegram.envelope.v1';
const REPLY_DOMAIN = 'vastaflow.telegram.reply.v1';

/**
 * O que o transporte afirma ter recebido do Telegram. Todos os campos estruturais
 * sao numericos/ids (validados antes de assinar e de novo na entrada do backend);
 * o texto entra na assinatura por hash, entao tem tamanho fixo no que se assina.
 */
export interface TelegramEnvelope {
  readonly version: typeof ENVELOPE_VERSION;
  readonly platform: typeof ENVELOPE_PLATFORM;
  /** Id do bot (parte numerica do token; nao e segredo). Escopo do `updateId`. */
  readonly botId: string;
  readonly updateId: number;
  readonly messageId: number;
  /** Chat privado: igual ao id do remetente. */
  readonly chatId: string;
  readonly userId: string;
  readonly chatType: 'private';
  readonly text: string;
  /** `message.date` do Telegram, em segundos Unix. */
  readonly sentAt: number;
  /** Quando o transporte assinou, em milissegundos Unix. Base da validade. */
  readonly issuedAt: number;
}

/** Resposta assinada do backend. */
export interface SignedReply {
  readonly outcome: string;
  readonly reply: string;
  readonly signature: string;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function hmac(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

function sameHex(expected: string, received: string): boolean {
  // `Buffer.from(x, 'hex')` PARA no primeiro caractere invalido: sem esta checagem,
  // uma assinatura valida seguida de lixo seria lida como valida.
  if (!HEX_SIGNATURE.test(received)) {
    return false;
  }
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  // Tamanhos diferentes (ou hex invalido) nunca casam; `timingSafeEqual` exige igual.
  return a.length === 32 && b.length === a.length && timingSafeEqual(a, b);
}

/** Forma canonica assinada. Campos fixos, ordem fixa, `\n` como separador. */
export function canonicalEnvelope(e: TelegramEnvelope): string {
  return [
    ENVELOPE_DOMAIN,
    e.version,
    e.platform,
    e.botId,
    String(e.updateId),
    String(e.messageId),
    e.chatId,
    e.userId,
    e.chatType,
    String(e.sentAt),
    String(e.issuedAt),
    sha256(e.text),
  ].join('\n');
}

export function signEnvelope(envelope: TelegramEnvelope, key: string): string {
  return hmac(key, canonicalEnvelope(envelope));
}

/** `true` so se a assinatura confere. Tempo constante; nunca lanca. */
export function verifyEnvelope(
  envelope: TelegramEnvelope,
  signature: string,
  key: string,
): boolean {
  return sameHex(signEnvelope(envelope, key), signature);
}

/** A MENSAGEM (nao o envelope) ainda e recente o bastante para executar? */
export function isMessageRecent(envelope: TelegramEnvelope, now: number): boolean {
  const sentMs = envelope.sentAt * 1000;
  return now - sentMs <= MESSAGE_MAX_AGE_MS && sentMs - now <= ENVELOPE_MAX_FUTURE_MS;
}

/** O envelope esta dentro da janela de validade? */
export function isEnvelopeFresh(envelope: TelegramEnvelope, now: number): boolean {
  return (
    now - envelope.issuedAt <= ENVELOPE_MAX_AGE_MS &&
    envelope.issuedAt - now <= ENVELOPE_MAX_FUTURE_MS
  );
}

/**
 * A resposta fica AMARRADA ao envelope que a originou (bot, update e chat): uma
 * resposta valida para uma mensagem nao serve para outra, nem para outro chat.
 */
function canonicalReply(envelope: TelegramEnvelope, outcome: string, reply: string): string {
  return [
    REPLY_DOMAIN,
    envelope.botId,
    String(envelope.updateId),
    envelope.chatId,
    outcome,
    sha256(reply),
  ].join('\n');
}

export function signReply(
  envelope: TelegramEnvelope,
  outcome: string,
  reply: string,
  key: string,
): string {
  return hmac(key, canonicalReply(envelope, outcome, reply));
}

export function verifyReply(envelope: TelegramEnvelope, signed: SignedReply, key: string): boolean {
  return sameHex(signReply(envelope, signed.outcome, signed.reply, key), signed.signature);
}
