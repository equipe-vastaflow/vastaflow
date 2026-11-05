import { MESSAGE_MAX_AGE_SECONDS, MESSAGE_MAX_FUTURE_SKEW_SECONDS, TEXT_MAX } from './constants.js';
import type { RawWaMessage } from './ports.js';

/** Por que uma mensagem foi descartada. Vocabulario FIXO: e o unico detalhe que vai para logs e contadores. */
export type IgnoreReason =
  | 'sem-chave'
  | 'sem-id'
  | 'propria'
  | 'evento-de-sistema'
  | 'grupo'
  | 'broadcast'
  | 'status'
  | 'newsletter'
  | 'jid-nao-suportado'
  | 'sem-conteudo'
  | 'reacao'
  | 'edicao'
  | 'protocolo'
  | 'encaminhada'
  | 'nao-texto'
  | 'texto-invalido'
  | 'remetente-invalido'
  | 'lid-sem-telefone'
  | 'jid-alt-invalido'
  | 'identidade-contraditoria'
  | 'sem-timestamp'
  | 'antiga'
  | 'futura'
  | 'historico';

/**
 * Como o NUMERO DE TELEFONE do remetente foi estabelecido (unica identidade que o backend recebe):
 * - `chat-pn`: o proprio chat e de telefone (`...@s.whatsapp.net`);
 * - `lid-com-telefone`: o chat e LID, e o WhatsApp informou o telefone correspondente em `remoteJidAlt`
 *   (validado como JID de telefone). Os digitos do LID NUNCA sao usados como telefone.
 */
export type PhoneSource = 'chat-pn' | 'lid-com-telefone';

export interface AcceptedMessage {
  readonly messageId: string;
  /** Telefone VERIFICADO do remetente (so digitos): a identidade enviada ao backend. Nunca derivado de um LID. */
  readonly from: string;
  readonly phoneSource: PhoneSource;
  /** Chat de ORIGEM: o unico destino possivel de uma resposta. Nunca sai do gateway. */
  readonly chatJid: string;
  readonly text: string;
  /** Segundos Unix. */
  readonly timestamp: number;
}

export type Classification =
  | { readonly accepted: true; readonly message: AcceptedMessage }
  | { readonly accepted: false; readonly reason: IgnoreReason };

const reject = (reason: IgnoreReason): Classification => ({ accepted: false, reason });

/** Telefone no formato E.164 sem o `+`: 8 a 15 digitos, sem zero a esquerda. */
const PHONE = /^[1-9]\d{7,14}$/;
/** LID: identificador numerico opaco. NAO e telefone, mesmo sendo feito de digitos. */
const LID_USER = /^\d{5,20}$/;

interface ParsedJid {
  readonly user: string;
  readonly server: string;
}

/** `usuario[:dispositivo]@servidor`. Qualquer outra forma = `null` (nao suportada). */
export function parseJid(jid: unknown): ParsedJid | null {
  if (typeof jid !== 'string' || jid.length === 0 || jid.length > 128) {
    return null;
  }
  const at = jid.lastIndexOf('@');
  if (at <= 0 || at === jid.length - 1) {
    return null;
  }
  const user = jid.slice(0, at).split(':')[0] ?? '';
  const server = jid.slice(at + 1);
  return user === '' ? null : { user, server };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Segundos Unix de um `number`, texto numerico, `bigint` ou `Long` (`toNumber()`). `null` se nao for valido. */
export function toSeconds(value: unknown): number | null {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'bigint') {
    n = Number(value);
  } else if (typeof value === 'string' && /^\d{1,15}$/.test(value)) {
    n = Number(value);
  } else if (isRecord(value) && typeof value.toNumber === 'function') {
    n = Number((value.toNumber as () => unknown)());
  } else {
    return null;
  }
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Texto de uma mensagem ja "desembrulhada", ou o motivo de nao ser texto suportado. */
function readText(message: object): { text: string } | { reason: IgnoreReason } {
  let content: Record<string, unknown> = isRecord(message) ? message : {};
  // Mensagens temporarias vem embrulhadas uma vez; o conteudo de dentro e que importa.
  const ephemeral = content.ephemeralMessage;
  if (isRecord(ephemeral) && isRecord(ephemeral.message)) {
    content = ephemeral.message;
  }
  if (content.reactionMessage !== undefined) {
    return { reason: 'reacao' };
  }
  if (content.editedMessage !== undefined) {
    return { reason: 'edicao' };
  }
  if (content.protocolMessage !== undefined) {
    return { reason: 'protocolo' };
  }
  if (typeof content.conversation === 'string') {
    return { text: content.conversation };
  }
  const extended = content.extendedTextMessage;
  if (isRecord(extended) && typeof extended.text === 'string') {
    const context = extended.contextInfo;
    // Encaminhada: o texto nao foi digitado por quem escreveu ao bot (mesma regra do canal da Meta).
    if (isRecord(context) && context.isForwarded === true) {
      return { reason: 'encaminhada' };
    }
    return { text: extended.text };
  }
  return { reason: 'nao-texto' };
}

function classifyChat(chatJid: string): ParsedJid | IgnoreReason {
  const parsed = parseJid(chatJid);
  if (parsed === null) {
    return 'jid-nao-suportado';
  }
  switch (parsed.server) {
    case 's.whatsapp.net':
    case 'lid':
      return parsed;
    case 'g.us':
      return 'grupo';
    case 'broadcast':
      return parsed.user === 'status' ? 'status' : 'broadcast';
    case 'newsletter':
      return 'newsletter';
    default:
      return 'jid-nao-suportado';
  }
}

/** Confere, de novo e isoladamente, que um valor e um telefone E.164 (o gateway repete a checagem antes de chamar o backend). */
export function isVerifiedPhone(value: string): boolean {
  return PHONE.test(value);
}

type ChatJid = ParsedJid;

/**
 * Estabelece o TELEFONE VERIFICADO do remetente, ou o motivo de nao ser possivel. Regra unica e fechada:
 *
 * 1. chat `@s.whatsapp.net`: o telefone e o usuario do chat (formato E.164);
 * 2. chat `@lid`: so ha telefone se `remoteJidAlt` for um JID `@s.whatsapp.net` bem formado (E.164). Os digitos do
 *    proprio LID NUNCA viram telefone: um LID e opaco e pode coincidir numericamente com o telefone de OUTRA pessoa;
 * 3. `remoteJidAlt` presente mas malformado, ou de tipo que nao seja telefone/LID: descartado;
 * 4. dados contraditorios (telefone no `remoteJidAlt` diferente do telefone do chat; `participant` em conversa
 *    individual) = descartado. Na duvida, nao ha identidade.
 */
function resolveSenderPhone(
  chat: ChatJid,
  key: NonNullable<RawWaMessage['key']>,
): { phone: string; source: PhoneSource } | IgnoreReason {
  const participant = key.participant;
  if (typeof participant === 'string' && participant !== '') {
    return 'identidade-contraditoria';
  }

  const rawAlt = key.remoteJidAlt;
  const hasAlt = rawAlt !== undefined && rawAlt !== null && rawAlt !== '';
  const alt = hasAlt ? parseJid(rawAlt) : null;
  if (hasAlt) {
    // So dois tipos de JID fazem sentido aqui; qualquer outra coisa (ou texto quebrado) invalida a mensagem.
    if (alt === null || (alt.server !== 's.whatsapp.net' && alt.server !== 'lid')) {
      return 'jid-alt-invalido';
    }
    if (alt.server === 's.whatsapp.net' && !PHONE.test(alt.user)) {
      return 'jid-alt-invalido';
    }
    if (alt.server === 'lid' && !LID_USER.test(alt.user)) {
      return 'jid-alt-invalido';
    }
  }

  if (chat.server === 's.whatsapp.net') {
    if (!PHONE.test(chat.user)) {
      return 'remetente-invalido';
    }
    // Chat de telefone com OUTRO telefone no campo alternativo: contradicao.
    if (alt?.server === 's.whatsapp.net' && alt.user !== chat.user) {
      return 'identidade-contraditoria';
    }
    return { phone: chat.user, source: 'chat-pn' };
  }

  // Chat LID.
  if (!LID_USER.test(chat.user)) {
    return 'remetente-invalido';
  }
  if (alt?.server !== 's.whatsapp.net') {
    return 'lid-sem-telefone';
  }
  return { phone: alt.user, source: 'lid-com-telefone' };
}

/**
 * Decide se uma mensagem recebida vira chamada ao backend. So passa: conversa INDIVIDUAL, de OUTRA pessoa, TEXTO
 * simples (1 a 4096 caracteres), nao encaminhada, recente, e cujo TELEFONE do remetente foi estabelecido de forma
 * confiavel (`resolveSenderPhone`). Tudo o mais e descartado com um motivo fixo, SEM chamar o backend.
 *
 * Remetente so com LID (sem telefone validado) = descartado (`lid-sem-telefone`): ver docs/whatsapp-gateway.md.
 */
export function classifyMessage(raw: RawWaMessage, nowSeconds: number): Classification {
  const key = raw.key;
  if (key === undefined || key === null) {
    return reject('sem-chave');
  }
  if (typeof key.id !== 'string' || key.id === '') {
    return reject('sem-id');
  }
  if (key.fromMe === true) {
    return reject('propria');
  }
  if (raw.broadcast === true) {
    return reject('broadcast');
  }
  if (raw.messageStubType !== undefined && raw.messageStubType !== null) {
    return reject('evento-de-sistema');
  }

  const chat = classifyChat(typeof key.remoteJid === 'string' ? key.remoteJid : '');
  if (typeof chat === 'string') {
    return reject(chat);
  }

  if (raw.message === undefined || raw.message === null) {
    return reject('sem-conteudo');
  }
  const content = readText(raw.message);
  if ('reason' in content) {
    return reject(content.reason);
  }
  if (content.text.length < 1 || content.text.length > TEXT_MAX) {
    return reject('texto-invalido');
  }

  const sender = resolveSenderPhone(chat, key);
  if (typeof sender === 'string') {
    return reject(sender);
  }

  const timestamp = toSeconds(raw.messageTimestamp);
  if (timestamp === null) {
    return reject('sem-timestamp');
  }
  if (nowSeconds - timestamp > MESSAGE_MAX_AGE_SECONDS) {
    return reject('antiga');
  }
  if (timestamp - nowSeconds > MESSAGE_MAX_FUTURE_SKEW_SECONDS) {
    return reject('futura');
  }

  return {
    accepted: true,
    message: {
      messageId: key.id,
      from: sender.phone,
      phoneSource: sender.source,
      chatJid: key.remoteJid as string,
      text: content.text,
      timestamp,
    },
  };
}
