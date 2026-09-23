import { ApiProperty } from '@nestjs/swagger';
import { FinancialEntryResponseDto } from './financial-entry-response.dto';

export class FinancialEntryPageResponseDto {
  @ApiProperty({
    type: [FinancialEntryResponseDto],
    description: 'Ordenado por data decrescente; o id desempata',
  })
  items: FinancialEntryResponseDto[];

  @ApiProperty({ example: 42, description: 'Total de lancamentos, em todas as paginas' })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
