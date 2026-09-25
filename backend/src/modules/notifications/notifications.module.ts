import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/**
 * Notificacoes internas.
 *
 * Nao importa `AuditModule`: este modulo nao grava na trilha, por decisao
 * documentada em `NotificationsService`. Tambem nao importa `UsersModule` nem
 * `UserDirectoryModule` - o destinatario e sempre o usuario autenticado, que a
 * requisicao ja traz resolvido, entao nao ha nome a buscar.
 *
 * Exporta o `NotificationsService` para que os modulos de negocio possam
 * avisar um usuario (`createForUser`) sem falar com o repositorio. Nenhum
 * modulo o importa ainda: nao ha disparador nesta etapa.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
