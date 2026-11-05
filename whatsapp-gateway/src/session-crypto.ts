import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra autenticada (AES-256-GCM) do estado de autenticacao do WhatsApp.
 *
 * Envelope gravado no banco (binario): `versao(1) | nonce(12) | texto cifrado | tag(16)`.
 * - nonce ALEATORIO de 12 bytes a cada gravacao (nunca reutilizado com a mesma chave);
 * - a tag de 16 bytes autentica o conteudo E o CONTEXTO (AAD): o contexto inclui sessao, tipo e id do item, entao uma
 *   linha copiada/trocada de lugar (ou de outra sessao) NAO decifra;
 * - qualquer falha (chave errada, adulteracao, truncamento, versao desconhecida) vira o MESMO erro fixo, sem detalhe.
 *
 * A chave vem so do ambiente do gateway, nunca de padrao, e nunca aparece em log, erro ou `JSON`/`inspect`.
 */
export const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;
/** 32 bytes ALEATORIOS tem ~30 valores distintos; menos de 16 indica chave fraca (zeros, repeticao, texto simples). */
const MIN_DISTINCT_BYTES = 16;
const MIN_ENVELOPE_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
/** Teto do item em claro: estado de sessao tem poucos KB; acima disso algo esta errado. */
export const MAX_PLAINTEXT_BYTES = 1024 * 1024;

/** Falha ao decifrar. Mensagem FIXA: nao diz se foi a chave, o contexto ou o conteudo (e nao deve dizer). */
export class SessionDecryptError extends Error {
  constructor() {
    super('nao foi possivel decifrar o estado da sessao (chave errada ou dados corrompidos)');
    this.name = 'SessionDecryptError';
  }
}

export interface ItemContext {
  readonly sessionId: string;
  readonly type: string;
  readonly id: string;
}

const aad = (ctx: ItemContext): Buffer =>
  Buffer.from(
    `vf-wa-auth|v${String(ENVELOPE_VERSION)}|${ctx.sessionId}|${ctx.type}|${ctx.id}`,
    'utf8',
  );

/**
 * Le a chave de cifra: 32 bytes em base64 ou 64 caracteres hexadecimais. Recusa tamanho errado e chaves obviamente
 * fracas (menos de 16 bytes distintos: zeros, repeticao, texto simples). Devolve `null` sem repetir o valor.
 */
export function parseEncryptionKey(text: string): Buffer | null {
  const value = text.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/]{43}=?$/.test(value)) {
    key = Buffer.from(value, 'base64');
  } else {
    return null;
  }
  if (key.length !== KEY_BYTES || new Set(key).size < MIN_DISTINCT_BYTES) {
    return null;
  }
  return key;
}

export class SessionCipher {
  readonly #key: Buffer;
  readonly #random: (size: number) => Buffer;

  constructor(key: Uint8Array, random: (size: number) => Buffer = randomBytes) {
    if (key.length !== KEY_BYTES) {
      throw new Error('chave de cifra invalida');
    }
    this.#key = Buffer.from(key);
    this.#random = random;
  }

  encrypt(plaintext: string, ctx: ItemContext): Buffer {
    const data = Buffer.from(plaintext, 'utf8');
    if (data.length > MAX_PLAINTEXT_BYTES) {
      throw new Error('item de sessao grande demais');
    }
    const nonce = this.#random(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(ctx));
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), nonce, body, cipher.getAuthTag()]);
  }

  decrypt(envelope: Buffer, ctx: ItemContext): string {
    try {
      if (envelope.length < MIN_ENVELOPE_BYTES || envelope[0] !== ENVELOPE_VERSION) {
        throw new SessionDecryptError();
      }
      const nonce = envelope.subarray(1, 1 + NONCE_BYTES);
      const tag = envelope.subarray(envelope.length - TAG_BYTES);
      const body = envelope.subarray(1 + NONCE_BYTES, envelope.length - TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad(ctx));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new SessionDecryptError();
    }
  }

  /** Nunca expor a chave por `JSON.stringify`, `util.inspect` ou log do objeto. */
  toJSON(): string {
    return '[SessionCipher]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[SessionCipher]';
  }
}
