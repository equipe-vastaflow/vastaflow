import { ApiProperty } from '@nestjs/swagger';
import type { Notification } from '../entities/notification.entity';
import { NotificationResponseDto, toNotificationResponse } from './notification-response.dto';

export class NotificationPageResponseDto {
  @ApiProperty({
    type: [NotificationResponseDto],
    description: 'Nao lidas primeiro; depois das mais recentes para as mais antigas',
  })
  items: NotificationResponseDto[];

  @ApiProperty({
    example: 42,
    description: 'Total de notificacoes do usuario, em todas as paginas',
  })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({
    example: 3,
    description: 'Quantas paginas existem com este `limit`. Minimo 1, mesmo sem nenhum item.',
  })
  totalPages: number;
}

/** Monta a pagina, com o calculo de `totalPages` num lugar so. */
export function toNotificationPage(
  items: Notification[],
  total: number,
  page: number,
  limit: number,
): NotificationPageResponseDto {
  return {
    items: items.map(toNotificationResponse),
    total,
    page,
    limit,
    // Lista vazia continua sendo "pagina 1 de 1", e nao "de 0".
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
