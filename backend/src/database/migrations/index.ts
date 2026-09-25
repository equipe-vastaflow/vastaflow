import type { MigrationInterface } from 'typeorm';
import type { DatabaseType } from '../../config/env.validation';
import { FinancialEntries1790136699120 as MysqlFinancialEntries } from './mysql/1790136699120-FinancialEntries';
import { InitialSchema1790020288252 as MysqlInitialSchema } from './mysql/1790020288252-InitialSchema';
import { SystemSettings1790303010994 as MysqlSystemSettings } from './mysql/1790303010994-SystemSettings';
import { FinancialEntries1790136699120 as OracleFinancialEntries } from './oracle/1790136699120-FinancialEntries';
import { InitialSchema1790020288252 as OracleInitialSchema } from './oracle/1790020288252-InitialSchema';
import { SystemSettings1790303010994 as OracleSystemSettings } from './oracle/1790303010994-SystemSettings';

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
  mysql: [MysqlInitialSchema, MysqlFinancialEntries, MysqlSystemSettings],
  oracle: [OracleInitialSchema, OracleFinancialEntries, OracleSystemSettings],
};
