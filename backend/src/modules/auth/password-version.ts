import { createHash } from 'node:crypto';

/**
 * "Versao" da senha de um usuario, gravada no JWT (`pv`) para que trocar a senha invalide os tokens
 * emitidos antes: e a impressao digital (SHA-256, truncada) do hash bcrypt ATUAL.
 *
 * Nao precisa de coluna nem de migration: o `senha_hash` ja muda a cada troca. O hash em si nunca vai
 * para o token, e a impressao truncada nao permite recupera-lo.
 */
export function passwordVersion(senhaHash: string): string {
  return createHash('sha256').update(senhaHash).digest('hex').slice(0, 16);
}
