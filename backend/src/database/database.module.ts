import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../config/env.validation';
import { buildTypeOrmOptions } from './database.config';

/**
 * Conexao com o banco (MySQL | Oracle, conforme `DATABASE_TYPE`).
 *
 * Os testes e2e trocam este modulo por uma base em memoria via
 * `overrideModule`, mantendo o resto do `AppModule` intacto.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildTypeOrmOptions(config),
    }),
  ],
})
export class DatabaseModule {}
