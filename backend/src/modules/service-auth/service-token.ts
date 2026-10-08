import { createHash, randomBytes } from 'node:crypto';
import {
  SERVICE_TOKEN_BYTES,
  SERVICE_TOKEN_PATTERN,
  SERVICE_TOKEN_PREFIX,
} from './service-auth.constants';

/**
 * Gera um token de servico: 256 bits de entropia criptografica, opaco.
 *
 * Nao e JWT, nao carrega claims e nao e decodificavel. O prefixo `vfs_` existe
 * so para ferramentas de varredura de segredo reconhecerem um vazamento.
 *
 * O valor devolvido aparece UMA vez (para ser colado no cofre do n8n); o
 * servidor guarda apenas o hash.
 */
export function generateServiceToken(): string {
  return `${SERVICE_TOKEN_PREFIX}${randomBytes(SERVICE_TOKEN_BYTES).toString('base64url')}`;
}

/** `true` quando o texto tem o FORMATO de um token (nao quando ele e valido). */
export function hasServiceTokenFormat(token: string): boolean {
  return SERVICE_TOKEN_PATTERN.test(token);
}

/**
 * SHA-256 do token, em hexadecimal.
 *
 * Um hash rapido basta porque o token tem 256 bits aleatorios: nao ha espaco de
 * busca para atacar com forca bruta, que e o que justificaria um hash lento
 * (bcrypt, scrypt) para senhas escolhidas por pessoas.
 */
export function hashServiceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
