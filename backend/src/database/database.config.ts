import type { DataSourceOptions } from 'typeorm';
import { DatabaseType, type EnvironmentVariables } from '../config/env.validation';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';
import { resolveSslCa } from './ssl-ca';

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
  | 'DATABASE_SSL_CA_FILE'
>;

// A resolucao da CA (conteudo inline ou arquivo montado) e as mensagens de
// recusa moram em `ssl-ca.ts`, isoladas: e o unico ponto desta camada que toca
// o filesystem.
export { MISSING_CA_MESSAGE } from './ssl-ca';

/**
 * Configuracao TLS do MySQL, ou `undefined` quando TLS esta desligado.
 *
 * Objeto sempre, nunca o nome de um perfil embarcado do driver: o perfil
 * 'Amazon RDS' que existia aqui antes confiava na CA que assina os
 * certificados de TODA instancia RDS de TODO cliente AWS - e esta instalacao
 * nao usa RDS. Ver a nota sobre `verifyIdentity` em `buildMysqlSsl`.
 */
type MysqlSslOptions = {
  ca: string;
  rejectUnauthorized: true;
  verifyIdentity: true;
};

/**
 * Traduz `DATABASE_SSL`/`DATABASE_SSL_CA` na opcao `ssl` do `mysql2`.
 *
 * Sao DUAS garantias distintas, e as duas precisam ser pedidas explicitamente:
 *
 * 1. `rejectUnauthorized: true` valida a CADEIA - o certificado do servidor foi
 *    assinado por uma CA em que confiamos;
 * 2. `verifyIdentity: true` valida a IDENTIDADE - o certificado foi emitido
 *    para o host ao qual estamos conectando.
 *
 * `rejectUnauthorized` sozinho NAO entrega a segunda. No `mysql2` 3.24.4 as
 * duas opcoes sao separadas e apenas a primeira tem valor padrao
 * (`lib/connection_config.js`, "Default rejectUnauthorized to true"). Quando
 * `verifyIdentity` e falsy o driver substitui `checkServerIdentity` por uma
 * funcao que devolve `undefined` sempre (`lib/base/connection.js`), isto e,
 * desliga a conferencia de hostname. As proprias typings do pacote dizem:
 * "You should enable this but it is disabled by default right now for
 * backwards compatibility". Sem o item 2, qualquer certificado assinado pela
 * CA configurada serve para qualquer hostname.
 *
 * O hostname conferido e o que o driver recebe em `host`, ou seja o
 * `DATABASE_HOST` (ou o host de `DATABASE_URL`). Nenhum nome e fixado aqui: o
 * certificado do servidor e que precisa trazer esse nome no SAN. Em producao
 * ha uma regra de ambiente exigindo que esse host NAO seja um literal de IP,
 * porque o `mysql2` so envia `servername` quando o host nao e IP - com IP a
 * conferencia de identidade seria saltada em silencio.
 *
 * Nao existe variavel para desligar nenhuma das duas garantias.
 *
 * A CA e OBRIGATORIA quando TLS esta ligado, e vem de `DATABASE_SSL_CA`
 * (conteudo) ou `DATABASE_SSL_CA_FILE` (arquivo montado) - exatamente uma das
 * duas, ver `ssl-ca.ts`. Antes, sem CA, caia-se no perfil embarcado
 * 'Amazon RDS'; numa instalacao self-hosted isso nao chega a conectar, e num
 * ambiente que fale com RDS seria confianca numa CA compartilhada por milhares
 * de instancias alheias. Falhar aqui, na montagem da configuracao, e mais claro
 * que falhar no handshake.
 *
 * @throws Error quando `DATABASE_SSL` esta ligado e a CA falta, esta ambigua ou
 *   o arquivo nao serve.
 */
function buildMysqlSsl(env: DatabaseEnvironment): MysqlSslOptions | undefined {
  if (!env.DATABASE_SSL) {
    return undefined;
  }

  const ca = resolveSslCa({ inline: env.DATABASE_SSL_CA, file: env.DATABASE_SSL_CA_FILE });

  return { ca, rejectUnauthorized: true, verifyIdentity: true };
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
 * - TLS do MySQL: a montagem da opcao `ssl` e coberta por testes de unidade, e
 *   o repasse dela ao driver foi conferido no proprio TypeORM instalado
 *   (`driver/mysql/MysqlDriver.js`, `createConnectionOptions`, que faz
 *   `ssl: options.ssl` sem filtrar chaves). NENHUM handshake TLS real foi
 *   estabelecido: nao existe, nesta etapa, servidor MySQL com certificado
 *   proprio para conectar. Em particular, que `verifyIdentity: true` de fato
 *   RECUSE um certificado cujo SAN nao casa com o host so sera comprovado na
 *   fase de containerizacao, contra um MySQL real.
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
