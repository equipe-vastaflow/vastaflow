import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDirectoryModule } from '../users/user-directory.module';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Importa `UserDirectoryModule` (somente leitura de id/nome/e-mail), e NAO
 * `UsersModule`: este ultimo ja depende deste modulo para gravar auditoria, e
 * o import de volta criaria um ciclo.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), UserDirectoryModule],
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
