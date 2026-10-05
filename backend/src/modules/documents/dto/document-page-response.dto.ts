import { ApiProperty } from '@nestjs/swagger';
import { DocumentResponseDto } from './document-response.dto';

export class DocumentPageResponseDto {
  @ApiProperty({
    type: [DocumentResponseDto],
    description: 'Ordenado por data de envio decrescente; o id desempata',
  })
  items: DocumentResponseDto[];

  @ApiProperty({ example: 42, description: 'Total de documentos, em todas as paginas' })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
