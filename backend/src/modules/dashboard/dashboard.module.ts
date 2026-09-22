import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Dashboard administrativo: apenas agrega o que os outros modulos ja expoem.
 *
 * Sem entity, sem repositorio e sem tabela propria - por isso nenhuma migration
 * foi necessaria. Modulos futuros (financeiro, automacoes, integracoes) entram
 * aqui como novas dependencias e novas secoes do resumo.
 */
@Module({
  imports: [UsersModule, AuditModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
