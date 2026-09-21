import type { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DatabaseType, type EnvironmentVariables } from '../config/env.validation';

const DEFAULT_PORTS: Record<DatabaseType, number> = {
  [DatabaseType.Mysql]: 3306,
  [DatabaseType.Oracle]: 1521,
};

/**
 * Traduz as variaveis `DATABASE_*` na configuracao do TypeORM.
 *
 * MySQL e o banco do desenvolvimento e esta verificado. O ramo Oracle segue o
 * ADR 0001, mas ainda nao foi exercitado contra uma instancia real.
 */
export function buildTypeOrmOptions(
  config: ConfigService<EnvironmentVariables, true>,
): TypeOrmModuleOptions {
  const type = config.get('DATABASE_TYPE', { infer: true });
  const url = config.get('DATABASE_URL', { infer: true });

  const common = {
    // Cada modulo registra suas entities via `TypeOrmModule.forFeature`.
    autoLoadEntities: true,
    synchronize: config.get('DATABASE_SYNCHRONIZE', { infer: true }),
  };

  const connection = url
    ? { url }
    : {
        host: config.get('DATABASE_HOST', { infer: true }),
        port: config.get('DATABASE_PORT', { infer: true }) ?? DEFAULT_PORTS[type],
        username: config.get('DATABASE_USER', { infer: true }),
        password: config.get('DATABASE_PASSWORD', { infer: true }),
      };

  if (type === DatabaseType.Oracle) {
    return {
      ...common,
      ...connection,
      type: 'oracle',
      sid: config.get('DATABASE_ORACLE_SID', { infer: true }),
      serviceName: config.get('DATABASE_ORACLE_SERVICE_NAME', { infer: true }),
    };
  }

  return {
    ...common,
    ...connection,
    type: 'mysql',
    database: config.get('DATABASE_NAME', { infer: true }),
    charset: 'utf8mb4',
    // Datas sempre em UTC; a conversao para o fuso local fica no cliente.
    timezone: 'Z',
  };
}
