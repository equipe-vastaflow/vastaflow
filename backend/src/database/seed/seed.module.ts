import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../modules/permissions/permissions.module';
import { RolesModule } from '../../modules/roles/roles.module';
import { SettingsModule } from '../../modules/settings/settings.module';
import { UsersModule } from '../../modules/users/users.module';
import { SeedService } from './seed.service';

@Module({
  imports: [PermissionsModule, RolesModule, SettingsModule, UsersModule],
  providers: [SeedService],
})
export class SeedModule {}
