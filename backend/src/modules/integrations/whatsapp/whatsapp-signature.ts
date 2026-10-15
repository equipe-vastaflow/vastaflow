import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura do webhook da Meta: cabecalho `X-Hub-Signature-256: sha256=<hex>`, que e o HMAC-SHA256
 * do CORPO BRUTO (os bytes exatos recebidos) com o App Secret do app. Puro: so `node:crypto`.
 *
 * Sem corpo bruto, cabecalho ausente, em outro formato ou com tamanho errado: `false`, nunca lanca.
 * Comparacao em tempo constante. O hex e estrito (`^[0-9a-f]{64}$`): `Buffer.from(x,'hex')` para no
 * primeiro caractere invalido, o que aceitaria uma assinatura valida seguida de lixo.
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (rawBody === undefined || typeof header !== 'string' || appSecret === '') {
    return false;
  }
  const match = /^sha256=([0-9a-f]{64})$/.exec(header);
  if (match === null) {
    return false;
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(match[1] ?? '', 'hex'));
}

/** Compara dois textos sem vazar o tamanho nem o prefixo (via hash de tamanho fixo). */
export function safeEqualText(a: string, b: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}

const CHALLENGE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Verificacao do webhook (GET): `hub.mode=subscribe`, `hub.verify_token` igual ao configurado e
 * `hub.challenge` devolvido. O desafio so e ecoado se tiver formato inofensivo (a Meta envia um
 * numero): nada refletido de uma entrada arbitraria.
 */
export function verifyChallenge(
  query: Record<string, unknown>,
  expectedToken: string,
): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (
    mode !== 'subscribe' ||
    typeof token !== 'string' ||
    typeof challenge !== 'string' ||
    expectedToken === '' ||
    !safeEqualText(token, expectedToken) ||
    !CHALLENGE.test(challenge)
  ) {
    return null;
  }
  return challenge;
}
