import { Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { DatabaseModule } from '../../src/database/database.module';
import { InMemoryStorageAdapter } from '../../src/modules/documents/storage/in-memory-storage.adapter';
import { DOCUMENT_STORAGE } from '../../src/modules/documents/storage/storage.port';

/** Banco SQLite em memoria: sem MySQL/Docker, e isolado por instancia da aplicacao. */
@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', autoLoadEntities: true, synchronize: true })],
})
class InMemoryDatabaseModule {}

/**
 * Sobe a aplicacao COMPLETA (mesmos modulos, guards, pipes e filtros de
 * producao), trocando apenas a conexao com o banco.
 */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(DatabaseModule)
    .useModule(InMemoryDatabaseModule)
    // Storage em memoria: o e2e nao escreve arquivo de verdade. E a MESMA
    // `StoragePort` de producao, entao a regra exercitada e a mesma - muda so
    // onde os bytes ficam. Os testes alcancam o adapter por
    // `app.get(DOCUMENT_STORAGE)` para conferir rollback.
    .overrideProvider(DOCUMENT_STORAGE)
    .useClass(InMemoryStorageAdapter)
    .compile();

  // Tipado como aplicacao Express pelo mesmo motivo de `main.ts`: e o que
  // permite ao `configureApp` ajustar `trust proxy` e o limite de corpo. Assim
  // o e2e exercita exatamente o pipeline de producao, incluindo essas duas
  // configuracoes.
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
