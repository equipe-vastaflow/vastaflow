import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UserDirectoryModule } from '../users/user-directory.module';
import { SystemSetting } from './entities/system-setting.entity';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';
import { SystemSettingsService } from './system-settings.service';

/**
 * Configuracoes internas do sistema.
 *
 * Importa `AuditModule` para gravar na trilha existente e `UserDirectoryModule`
 * (somente leitura de id/nome/e-mail) para nomear o responsavel em lote - e nao
 * `UsersModule`, que traria regra de negocio de usuarios para dentro daqui e
 * fecharia um ciclo.
 *
 * Exporta o `SystemSettingsService` - e SO ele: e o caminho pelo qual outros
 * modulos leem uma configuracao ja tipada. O `SettingsService`, que altera e
 * audita, fica restrito ao proprio controller. O `SettingsRepository` tambem e
 * exportado porque o seeder cria as chaves que faltam no boot.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting]), AuditModule, UserDirectoryModule],
  controllers: [SettingsController],
  providers: [SettingsRepository, SettingsService, SystemSettingsService],
  exports: [SystemSettingsService, SettingsRepository],
})
export class SettingsModule {}
