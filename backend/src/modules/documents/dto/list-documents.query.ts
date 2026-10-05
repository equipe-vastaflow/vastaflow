import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Mesma paginacao de `/finance/entries`, `/users` e `/audit-logs`.
 *
 * `MAX_PAGE_SIZE` existe para que nao haja consulta ilimitada: `limit=999999`
 * e recusado com 400 pelo proprio validador. Nao ha filtro nesta fase - nem por
 * nome, nem por tipo, nem por autor -, porque nenhum deles foi pedido.
 */
export class ListDocumentsQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
