import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RolesModule } from '../roles/roles.module';
import { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { UserManagementService } from './user-management.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * Usuarios: administracao (`/users`) e dados pessoais do proprio usuario
 * (`/profile`).
 *
 * O perfil mora aqui, e nao num modulo proprio, porque grava na tabela `users`
 * - e o projeto mantem deliberadamente as escritas dessa tabela dentro deste
 * modulo (foi por isso que o `UserDirectoryModule` nasceu como fronteira
 * SOMENTE LEITURA para os demais). Um modulo de perfil separado precisaria do
 * `UsersRepository` e abriria essa porta.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), RolesModule, AuditModule],
  controllers: [UsersController, ProfileController],
  providers: [
    UsersRepository,
    UsersService,
    PasswordService,
    UserManagementService,
    ProfileService,
  ],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
