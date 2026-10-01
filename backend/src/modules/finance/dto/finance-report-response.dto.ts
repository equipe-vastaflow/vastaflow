import { ApiProperty } from '@nestjs/swagger';
import type { FinanceFilter } from '../finance-filter';
import { FinancialEntryStatus, FinancialEntryType } from '../financial-entry.enums';

/** O recorte efetivamente aplicado, devolvido junto para o cliente conferir. */
export class ReportFiltersDto {
  @ApiProperty({ example: '2026-01-01' })
  de: string;

  @ApiProperty({ example: '2026-01-31' })
  ate: string;

  @ApiProperty({ enum: FinancialEntryStatus, nullable: true, type: String })
  status: FinancialEntryStatus | null;

  @ApiProperty({ enum: FinancialEntryType, nullable: true, type: String })
  tipo: FinancialEntryType | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  categoria: string | null;
}

export class StatusTotalDto {
  @ApiProperty({ enum: FinancialEntryStatus })
  status: FinancialEntryStatus;

  @ApiProperty({ example: 30 })
  quantidade: number;

  @ApiProperty({ example: 12000, description: 'Soma dos valores, sempre positiva' })
  valor: number;
}

export class TypeTotalDto {
  @ApiProperty({ enum: FinancialEntryType })
  tipo: FinancialEntryType;

  @ApiProperty({ example: 12 })
  quantidade: number;

  @ApiProperty({ example: 15000, description: 'Soma dos valores, sempre positiva' })
  valor: number;
}

export class CategoryTotalDto {
  @ApiProperty({ example: 'Insumos' })
  categoria: string;

  @ApiProperty({ example: 8 })
  quantidade: number;

  @ApiProperty({ example: 3200, description: 'Soma dos valores, sempre positiva' })
  valor: number;
}

/**
 * Resumo do conjunto filtrado. Todos os numeros vem de agregacao no banco.
 *
 * NAO existe um `valorTotal` generico: `valor` e sempre positivo e o sinal esta
 * no `tipo`, entao somar receitas com despesas produziria um numero sem
 * significado. Quem representa dinheiro liquido e o `saldo`.
 */
export class FinanceReportSummaryDto {
  @ApiProperty({ type: ReportFiltersDto })
  filtros: ReportFiltersDto;

  @ApiProperty({
    example: 42,
    description: 'Lancamentos no recorte, incluindo os CANCELADOS',
  })
  totalRegistros: number;

  @ApiProperty({ example: 15000, description: 'Soma das RECEITAS nao canceladas' })
  totalReceitas: number;

  @ApiProperty({ example: 9300.25, description: 'Soma das DESPESAS nao canceladas' })
  totalDespesas: number;

  @ApiProperty({
    example: 5699.75,
    description: 'Receitas menos despesas, ambas sem os CANCELADOS. Pode ser negativo.',
  })
  saldo: number;

  @ApiProperty({ type: [StatusTotalDto], description: 'Inclui CANCELADO' })
  porStatus: StatusTotalDto[];

  @ApiProperty({ type: [TypeTotalDto] })
  porTipo: TypeTotalDto[];

  @ApiProperty({ type: [CategoryTotalDto], description: 'Ordenado pela categoria' })
  porCategoria: CategoryTotalDto[];
}

/** Normaliza o recorte aplicado para a resposta: ausente vira `null`. */
export function toReportFilters(
  filter: FinanceFilter & { de: string; ate: string },
): ReportFiltersDto {
  return {
    de: filter.de,
    ate: filter.ate,
    status: filter.status ?? null,
    tipo: filter.tipo ?? null,
    categoria: filter.categoria ?? null,
  };
}
