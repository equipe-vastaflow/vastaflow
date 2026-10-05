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
  | 'DATABASE_SSL'
  | 'DATABASE_SSL_CA'
>;

/**
 * Pacote de CAs que o `mysql2` embarca para os bancos gerenciados da AWS.
 *
 * O driver resolve este nome internamente (`lib/constants/ssl_profiles.js`) e
 * valida o certificado do servidor contra ele. Usar o pacote do driver evita
 * ter certificado no repositorio e evita um arquivo para montar no servidor.
 */
const MANAGED_CA_PROFILE = 'Amazon RDS';

/** Configuracao TLS do MySQL, ou `undefined` quando TLS esta desligado. */
type MysqlSslOptions = string | { ca: string; rejectUnauthorized: true };

/**
 * Traduz `DATABASE_SSL`/`DATABASE_SSL_CA` na opcao `ssl` do `mysql2`.
 *
 * `rejectUnauthorized` e sempre `true`, e nao ha variavel para desliga-lo:
 * cifrar sem verificar a identidade do servidor protege contra escuta passiva
 * e nao contra um intermediario ativo.
 *
 * Sem CA informada, cai no pacote embarcado pelo driver - o caminho previsto
 * para banco gerenciado. Com CA informada, usa exatamente aquela.
 */
function buildMysqlSsl(env: DatabaseEnvironment): MysqlSslOptions | undefined {
  if (!env.DATABASE_SSL) {
    return undefined;
  }
  return env.DATABASE_SSL_CA
    ? { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true }
    : MANAGED_CA_PROFILE;
}

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
 * - TLS do MySQL: a montagem da opcao `ssl` e coberta por testes de unidade;
 *   NENHUMA conexao TLS real foi estabelecida, porque nao ha servidor MySQL
 *   com TLS disponivel nesta etapa.
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

  const ssl = buildMysqlSsl(env);

  return {
    ...common,
    ...connection,
    type: 'mysql',
    database: env.DATABASE_NAME,
    charset: 'utf8mb4',
    // Datas sempre em UTC; a conversao para o fuso local fica no cliente.
    timezone: 'Z',
    // Omitido quando desligado, em vez de `ssl: undefined`: o driver trata as
    // duas formas igual, mas a opcao ausente deixa claro no objeto quando TLS
    // nao esta em uso.
    ...(ssl === undefined ? {} : { ssl }),
  };
}
