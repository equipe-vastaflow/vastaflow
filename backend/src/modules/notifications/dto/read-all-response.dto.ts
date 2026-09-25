import { ApiProperty } from '@nestjs/swagger';

export class ReadAllResponseDto {
  @ApiProperty({
    example: 3,
    description: 'Quantas passaram de nao lida para lida. Zero quando ja estavam todas lidas.',
  })
  atualizadas: number;
}
