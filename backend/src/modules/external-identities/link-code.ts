import { createHash, randomBytes } from 'node:crypto';

/**
 * Alfabeto Crockford base32: sem I, L, O e U, para o codigo ser copiado ou
 * digitado sem ambiguidade. 32 simbolos = 5 bits por caractere.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 12 caracteres = 60 bits de entropia. */
export const LINK_CODE_LENGTH = 12;

const NORMALIZED = new RegExp(`^[${ALPHABET}]{${LINK_CODE_LENGTH}}$`);

/**
 * Codigo de uso unico que prova a posse da conta externa.
 *
 * `randomBytes` (CSPRNG). Cada byte vira um simbolo pelos 5 bits baixos: 256 e
 * multiplo de 32, entao a distribuicao e uniforme. Formatado em grupos de 4
 * (`XXXX-XXXX-XXXX`) so para leitura - o hifen nao faz parte do codigo.
 *
 * 60 bits com validade curta tornam adivinhacao inviavel mesmo sem limite de
 * tentativas: a chance de acertar um codigo pendente e desprezivel.
 */
export function generateLinkCode(): string {
  const chars = [...randomBytes(LINK_CODE_LENGTH)].map((byte) => ALPHABET[byte & 31]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/**
 * Forma canonica do que a pessoa enviou: maiusculas, sem hifens nem espacos.
 * `null` se nao tiver o formato de um codigo - nem chega a ser procurado.
 */
export function normalizeLinkCode(input: string): string | null {
  const normalized = input.toUpperCase().replace(/[\s-]/g, '');
  return NORMALIZED.test(normalized) ? normalized : null;
}

/**
 * O que vai para o banco: SHA-256 do codigo normalizado, em hex. O codigo em si
 * nunca e gravado - quem le a tabela nao consegue usa-lo. Hash rapido e
 * suficiente aqui (ao contrario de senha): o codigo e aleatorio, com 60 bits,
 * e nao ha dicionario a testar.
 */
export function hashLinkCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
