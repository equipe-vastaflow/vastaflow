import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FinanceFilterQuery } from './finance-filter.query';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Mesma paginacao de `/users` e `/audit-logs`, mais os filtros opcionais de
 * lancamento (`FinanceFilterQuery`: periodo, status, tipo, categoria).
 *
 * Os filtros sao ADITIVOS: sem nenhum deles a resposta e a mesma de antes, e
 * `page`/`limit` continuam valendo igual. Sao os mesmos filtros dos relatorios,
 * herdados do mesmo lugar - nao ha dois dialetos.
 */
export class ListEntriesQuery extends FinanceFilterQuery {
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
