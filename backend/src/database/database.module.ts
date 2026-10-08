import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../config/env.validation';
import { buildDataSourceOptions, type DatabaseEnvironment } from './database.config';
import { PendingMigrationsCheck } from './pending-migrations.check';

/**
 * Conexao com o banco (MySQL | Oracle, conforme `DATABASE_TYPE`).
 *
 * A aplicacao NAO executa migrations ao subir: elas rodam por comando explicito
 * (`npm run migration:run`), antes do deploy. Se houver migration pendente, o
 * boot e interrompido com uma mensagem clara (`PendingMigrationsCheck`).
 * Ver database/README.md.
 *
 * Os testes e2e trocam este modulo por uma base em memoria via
 * `overrideModule`, mantendo o resto do `AppModule` intacto.
 */
/**
 * `DatabaseEnvironment` com TODAS as chaves obrigatorias (o valor ainda pode
 * ser `undefined`).
 *
 * Existe porque quase todas as chaves de `DatabaseEnvironment` sao OPCIONAIS no
 * tipo (`?:`), entao omitir uma delas compila sem erro. Foi exatamente o que
 * aconteceu com `DATABASE_SSL_CA_FILE`: foi adicionada ao tipo e a validacao de
 * ambiente, esquecida aqui, e a aplicacao entrava em laco de reinicio em
 * container (`DATABASE_SSL=true exige a CA...`) enquanto o CLI de migrations -
 * que recebe o `env` inteiro - funcionava. Os testes unitarios nao pegavam
 * (chamam `buildDataSourceOptions` direto) e os e2e trocam este modulo por
 * SQLite. So a execucao em Docker expôs. Com este tipo, esquecer uma chave
 * passa a ser erro de compilacao.
 */
type Exhaustive<T> = {
  // So as chaves que JA aceitam `undefined` continuam aceitando. Uma versao mais
  // frouxa (`T[K] | undefined` para todas) deixava passar `undefined` em chave
  // obrigatoria como `DATABASE_TYPE`, e o typecheck recusava a chamada.
  [K in keyof T]-?: undefined extends T[K] ? T[K] | undefined : T[K];
};

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const env: Exhaustive<DatabaseEnvironment> = {
          DATABASE_TYPE: config.get('DATABASE_TYPE', { infer: true }),
          DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
          DATABASE_HOST: config.get('DATABASE_HOST', { infer: true }),
          DATABASE_PORT: config.get('DATABASE_PORT', { infer: true }),
          DATABASE_NAME: config.get('DATABASE_NAME', { infer: true }),
          DATABASE_USER: config.get('DATABASE_USER', { infer: true }),
          DATABASE_PASSWORD: config.get('DATABASE_PASSWORD', { infer: true }),
          DATABASE_ORACLE_SID: config.get('DATABASE_ORACLE_SID', { infer: true }),
          DATABASE_ORACLE_SERVICE_NAME: config.get('DATABASE_ORACLE_SERVICE_NAME', { infer: true }),
          DATABASE_SYNCHRONIZE: config.get('DATABASE_SYNCHRONIZE', { infer: true }),
          DATABASE_SSL: config.get('DATABASE_SSL', { infer: true }),
          DATABASE_SSL_CA: config.get('DATABASE_SSL_CA', { infer: true }),
          DATABASE_SSL_CA_FILE: config.get('DATABASE_SSL_CA_FILE', { infer: true }),
        };
        return buildDataSourceOptions(env);
      },
    }),
  ],
  providers: [PendingMigrationsCheck],
})
export class DatabaseModule {}
