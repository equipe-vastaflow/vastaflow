import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UserDirectoryModule } from '../users/user-directory.module';
import { FinancialEntry } from './entities/financial-entry.entity';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { FinanceService } from './finance.service';

/**
 * Dominio financeiro: lancamentos internos.
 *
 * Importa `AuditModule` para gravar na trilha existente e `UserDirectoryModule`
 * (somente leitura de id/nome/e-mail) para nomear o autor em lote - e nao
 * `UsersModule`, que traria regra de negocio de usuarios para dentro daqui.
 *
 * Exporta o `FinanceService` porque o comando `/financeiro` depende dele: o
 * handler usa o service, nunca o repositorio.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FinancialEntry]), AuditModule, UserDirectoryModule],
  controllers: [FinanceController],
  providers: [FinanceRepository, FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
