import { QueryFailedError } from 'typeorm';

/**
 * O erro do banco e uma violacao de restricao UNIQUE.
 *
 * Cada banco sinaliza de um jeito: MySQL `ER_DUP_ENTRY`/1062, Oracle
 * `ORA-00001`, SQLite `UNIQUE constraint failed` (usado nos testes). Quem chama
 * sabe qual restricao a tabela tem e traduz para o erro de dominio adequado.
 *
 * E a forma de tratar corrida: duas insercoes simultaneas passam pela checagem
 * previa, mas so uma passa pelo indice unico - a outra cai aqui.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: unknown; errno?: unknown } | undefined;
  if (driverError?.code === 'ER_DUP_ENTRY' || driverError?.errno === 1062) {
    return true;
  }
  return /UNIQUE constraint failed|ORA-00001/i.test(error.message);
}
