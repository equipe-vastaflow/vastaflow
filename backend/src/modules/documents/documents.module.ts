import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AuditModule } from '../audit/audit.module';
import { UserDirectoryModule } from '../users/user-directory.module';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { Document } from './entities/document.entity';
import { LocalStorageAdapter } from './storage/local-storage.adapter';
import { DOCUMENT_STORAGE } from './storage/storage.port';

/**
 * Documentos: metadados no banco, bytes no storage.
 *
 * O adapter de storage e amarrado AQUI, no token `DOCUMENT_STORAGE`, e em
 * nenhum outro lugar. Trocar o filesystem local pelo S3 e trocar esta
 * `useFactory` - service, controller, DTOs, RBAC e auditoria nao mudam.
 *
 * Hoje existe UM adapter de producao (local). NAO ha variavel escolhendo
 * provider: criar uma opcao `s3` apontando para um adapter que nao existe seria
 * oferecer configuracao que falha no boot. Quando o `S3StorageAdapter` existir,
 * a escolha entra junto com ele.
 *
 * O limite de tamanho do upload vem do `MulterModule`, lido da configuracao: e
 * um limite PROPRIO do endpoint, independente do limite global de corpo de
 * 100 kB da Fase A, que continua valendo para as rotas JSON.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        limits: {
          fileSize: config.get('DOCUMENT_MAX_FILE_SIZE', { infer: true }),
          // Um arquivo por requisicao: nao ha envio em lote nesta fase.
          files: 1,
        },
      }),
    }),
    AuditModule,
    UserDirectoryModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsRepository,
    DocumentsService,
    {
      provide: DOCUMENT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): LocalStorageAdapter =>
        new LocalStorageAdapter(config.get('DOCUMENT_STORAGE_PATH', { infer: true })),
    },
  ],
})
export class DocumentsModule {}
