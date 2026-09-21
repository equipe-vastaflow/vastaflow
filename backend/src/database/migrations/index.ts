import type { MigrationInterface } from 'typeorm';
import type { DatabaseType } from '../../config/env.validation';
import { InitialSchema1790020288252 as MysqlInitialSchema } from './mysql/1790020288252-InitialSchema';
import { InitialSchema1790020288252 as OracleInitialSchema } from './oracle/1790020288252-InitialSchema';

type MigrationClass = new () => MigrationInterface;

/**
 * Migrations registradas, por banco (ADR 0001: o DDL nao e portavel).
 *
 * Lista explicita em vez de glob: funciona igual no codigo compilado, no
 * ts-jest e no CLI. Toda migration nova precisa ser adicionada aqui, na ordem
 * de execucao - o teste `database-compatibility.spec.ts` falha se algum arquivo
 * das pastas `mysql/` ou `oracle/` ficar de fora.
 */
export const MIGRATIONS: Record<DatabaseType, MigrationClass[]> = {
  mysql: [MysqlInitialSchema],
  oracle: [OracleInitialSchema],
};
