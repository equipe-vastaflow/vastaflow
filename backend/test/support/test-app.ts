import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { DatabaseModule } from '../../src/database/database.module';

/** Banco SQLite em memoria: sem MySQL/Docker, e isolado por instancia da aplicacao. */
@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', autoLoadEntities: true, synchronize: true })],
})
class InMemoryDatabaseModule {}

/**
 * Sobe a aplicacao COMPLETA (mesmos modulos, guards, pipes e filtros de
 * producao), trocando apenas a conexao com o banco.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(DatabaseModule)
    .useModule(InMemoryDatabaseModule)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
