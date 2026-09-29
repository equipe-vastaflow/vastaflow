import { ApiProperty } from '@nestjs/swagger';
import type { Notification } from '../entities/notification.entity';
import { NotificationType } from '../notification.enums';

/**
 * Notificacao como a API a devolve.
 *
 * `usuarioId` NAO e exposto: toda notificacao devolvida pertence, por
 * construcao, ao usuario autenticado - repetir o id dele em cada item nao
 * acrescenta informacao.
 */
export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Lancamento aprovado' })
  titulo: string;

  @ApiProperty({ example: 'O lancamento de manutencao foi marcado como pago.' })
  mensagem: string;

  @ApiProperty({ enum: NotificationType })
  tipo: NotificationType;

  @ApiProperty({ example: false })
  lida: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  /**
   * Mantido por compatibilidade: o frontend o lia como momento da leitura antes
   * de `readAt` existir. Para saber quando foi lida, use `readAt`.
   */
  @ApiProperty({ format: 'date-time', description: 'Ultima alteracao do registro' })
  updatedAt: Date;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'Quando foi marcada como lida pela primeira vez; null enquanto nao lida',
  })
  readAt: Date | null;
}

export function toNotificationResponse(notification: Notification): NotificationResponseDto {
  return {
    id: notification.id,
    titulo: notification.titulo,
    mensagem: notification.mensagem,
    tipo: notification.tipo,
    lida: notification.lida,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
    readAt: notification.readAt,
  };
}
