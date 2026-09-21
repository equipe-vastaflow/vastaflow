import type { DataSourceOptions } from 'typeorm';
import { DatabaseType, type EnvironmentVariables } from '../config/env.validation';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

const DEFAULT_PORTS: Record<DatabaseType, number> = {
  [DatabaseType.Mysql]: 3306,
  [DatabaseType.Oracle]: 1521,
};

/** Variaveis de ambiente que a camada de persistencia consome. */
export type DatabaseEnvironment = Pick<
  EnvironmentVariables,
  | 'DATABASE_TYPE'
  | 'DATABASE_URL'
  | 'DATABASE_HOST'
  | 'DATABASE_PORT'
  | 'DATABASE_NAME'
  | 'DATABASE_USER'
  | 'DATABASE_PASSWORD'
  | 'DATABASE_ORACLE_SID'
  | 'DATABASE_ORACLE_SERVICE_NAME'
  | 'DATABASE_SYNCHRONIZE'
>;

/**
 * Traduz as variaveis `DATABASE_*` na configuracao do TypeORM.
 *
 * Usada tanto pela aplicacao (`DatabaseModule`) quanto pelo CLI de migrations
 * (`data-source.ts`), para que os dois conectem exatamente do mesmo jeito.
 *
 * Estado de validacao (nao afirmar mais do que isto):
 * - MySQL: migrations executadas e revertidas contra um MySQL 8.4 real, e a
 *   aplicacao subiu contra ele com login funcionando. O ambiente Docker
 *   (`docker-compose.yml`) em si ainda nao foi executado.
 * - Oracle: metadata e DDL verificados offline por testes automatizados;
 *   NUNCA executado contra uma instancia Oracle real.
 */
export function buildDataSourceOptions(env: DatabaseEnvironment): DataSourceOptions {
  const type = env.DATABASE_TYPE;

  const common = {
    entities: ENTITIES,
    migrations: MIGRATIONS[type],
    migrationsTableName: 'migrations',
    synchronize: env.DATABASE_SYNCHRONIZE,
  };

  const connection = env.DATABASE_URL
    ? { url: env.DATABASE_URL }
    : {
        host: env.DATABASE_HOST,
        port: env.DATABASE_PORT ?? DEFAULT_PORTS[type],
        username: env.DATABASE_USER,
        password: env.DATABASE_PASSWORD,
      };

  if (type === DatabaseType.Oracle) {
    return {
      ...common,
      ...connection,
      type: 'oracle',
      sid: env.DATABASE_ORACLE_SID,
      serviceName: env.DATABASE_ORACLE_SERVICE_NAME,
    };
  }

  return {
    ...common,
    ...connection,
    type: 'mysql',
    database: env.DATABASE_NAME,
    charset: 'utf8mb4',
    // Datas sempre em UTC; a conversao para o fuso local fica no cliente.
    timezone: 'Z',
  };
}
