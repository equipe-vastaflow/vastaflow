import { randomUUID } from 'node:crypto';

/**
 * Tamanho maximo da chave na coluna `storage_key`.
 *
 * A chave gerada tem 55 caracteres (`AAAA/MM/DD/` + UUID + `.bin`); a coluna
 * tem folga para um prefixo diferente no futuro sem migration.
 */
export const STORAGE_KEY_MAX_LENGTH = 120;

/** Extensao fisica fixa: o tipo real do documento vive em `mime_type`, no banco. */
const PHYSICAL_EXTENSION = '.bin';

/**
 * Forma exata da chave gerada: `AAAA/MM/DD/<uuid>.bin`.
 *
 * Lista branca, e nao lista negra. Nenhuma sequencia de travessia (`..`,
 * `../`, `..\`), caminho absoluto (`/etc/passwd`, `C:\...`), contrabarra, byte
 * nulo ou caractere fora de `[0-9a-f-]` passa por aqui - nao porque sejam
 * recusados um a um, mas porque nada alem deste formato e aceito.
 */
const SAFE_STORAGE_KEY =
  /^\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/;

/**
 * Gera a chave fisica de um documento.
 *
 * Sempre no servidor: o cliente nunca escolhe onde o objeto mora. O nome
 * enviado pelo usuario NAO entra aqui, em nenhuma forma - nem como nome, nem
 * como slug, nem como extensao -, porque entao o caminho fisico passaria a
 * depender de entrada hostil.
 *
 * `randomUUID` usa gerador criptografico: a chave nao e adivinhavel. O prefixo
 * de data existe para que o storage nao vire um diretorio unico com milhoes de
 * objetos (e, no S3, para distribuir o prefixo) - ele NAO e o que protege a
 * chave, e justamente por isso o UUID e obrigatorio.
 *
 * A extensao e sempre `.bin`, nunca a do arquivo original: um objeto gravado
 * como `.html` ou `.svg` poderia ser servido e interpretado por algum
 * intermediario que olhasse apenas o caminho.
 */
export function generateStorageKey(now: Date = new Date()): string {
  const ano = now.getUTCFullYear();
  const mes = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(now.getUTCDate()).padStart(2, '0');

  // UTC, e nao fuso local: o prefixo precisa ser o mesmo em qualquer maquina.
  return `${ano}/${mes}/${dia}/${randomUUID()}${PHYSICAL_EXTENSION}`;
}

/** `true` apenas para chaves no formato exato que `generateStorageKey` produz. */
export function isSafeStorageKey(storageKey: string): boolean {
  return (
    storageKey.length <= STORAGE_KEY_MAX_LENGTH &&
    !storageKey.includes('\0') &&
    SAFE_STORAGE_KEY.test(storageKey)
  );
}
