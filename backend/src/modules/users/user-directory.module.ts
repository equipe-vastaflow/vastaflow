import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserDirectoryService } from './user-directory.service';

/**
 * Modulo de fronteira: so le a identidade de usuarios (id, nome, e-mail).
 *
 * NAO importa `UsersModule` nem `AuditModule`. E justamente isso que permite ao
 * `AuditModule` mostrar quem e o responsavel por um evento sem criar o ciclo
 * `UsersModule -> AuditModule -> UsersModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserDirectoryService],
  exports: [UserDirectoryService],
})
export class UserDirectoryModule {}
