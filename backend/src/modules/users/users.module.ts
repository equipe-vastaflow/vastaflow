import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RolesModule } from '../roles/roles.module';
import { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { UserManagementService } from './user-management.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), RolesModule, AuditModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService, PasswordService, UserManagementService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
