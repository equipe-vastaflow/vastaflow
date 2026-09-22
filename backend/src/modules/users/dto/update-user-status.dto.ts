import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({ description: '`true` ativa, `false` desativa o usuario' })
  @IsBoolean({ message: 'ativo deve ser true ou false' })
  ativo: boolean;
}
