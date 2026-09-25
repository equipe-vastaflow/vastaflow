import { ApiProperty } from '@nestjs/swagger';

export class UnreadCountResponseDto {
  @ApiProperty({ example: 3, description: 'Notificacoes por ler do usuario autenticado' })
  count: number;
}
