import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { FinanceFilter } from '../finance-filter';
import { FinancialEntryStatus, FinancialEntryType } from '../financial-entry.enums';
import { DATE_FORMAT } from './create-financial-entry.dto';
import { TrimString } from './finance-fields';

/** Mesmas mensagens nos dois DTOs: o recorte e um so, a validacao tambem. */
const DATE_ISO = 'deve ser uma data valida no formato YYYY-MM-DD';
const DATE_SHAPE = 'deve estar no formato YYYY-MM-DD, sem hora';

/**
 * Parte do recorte que e SEMPRE opcional, nos dois contratos.
 *
 * `de` e `ate` ficam fora daqui de proposito: sao opcionais na listagem e
 * obrigatorios no relatorio, e as duas subclasses declaram cada uma a sua
 * versao. Herdar um `@IsOptional()` e tentar torna-lo obrigatorio depois nao
 * funciona - o `class-validator` herda a metadata do pai, e o campo continuaria
 * aceitando ausencia.
 */
abstract class FinanceFilterBase {
  @ApiPropertyOptional({ enum: FinancialEntryStatus })
  @IsOptional()
  @IsEnum(FinancialEntryStatus, {
    message: `status deve ser um destes valores: ${Object.values(FinancialEntryStatus).join(', ')}`,
  })
  status?: FinancialEntryStatus;

  @ApiPropertyOptional({ enum: FinancialEntryType })
  @IsOptional()
  @IsEnum(FinancialEntryType, {
    message: `tipo deve ser um destes valores: ${Object.values(FinancialEntryType).join(', ')}`,
  })
  tipo?: FinancialEntryType;

  @ApiPropertyOptional({
    example: 'Insumos',
    maxLength: 60,
    description: 'Igualdade exata, como a collation do banco a compara',
  })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'categoria nao pode ser apenas espacos' })
  @MaxLength(60)
  categoria?: string;
}

/**
 * Filtros de lancamento, com `de` e `ate` OPCIONAIS.
 *
 * Usado por `GET /finance/entries`, que continua respondendo sem filtro nenhum.
 * Como o `ValidationPipe` global roda com `forbidNonWhitelisted`, parametro fora
 * desta lista resulta em 400.
 */
export class FinanceFilterQuery extends FinanceFilterBase implements FinanceFilter {
  @ApiPropertyOptional({ example: '2026-01-01', description: 'Inicio do periodo (inclusivo)' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: `de ${DATE_ISO}` })
  @Matches(DATE_FORMAT, { message: `de ${DATE_SHAPE}` })
  de?: string;

  @ApiPropertyOptional({ example: '2026-01-31', description: 'Fim do periodo (inclusivo)' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: `ate ${DATE_ISO}` })
  @Matches(DATE_FORMAT, { message: `ate ${DATE_SHAPE}` })
  ate?: string;
}

/**
 * Filtros de relatorio: os mesmos, com `de` e `ate` OBRIGATORIOS.
 *
 * O periodo e obrigatorio porque e ele que limita o custo da consulta - sem
 * recorte de data, um relatorio varreria a tabela inteira. As regras que
 * dependem das duas datas juntas (`ate >= de`, maximo de um ano) ficam em
 * `report-period.policy.ts`, aplicada pelo service.
 */
export class ReportFilterQuery extends FinanceFilterBase implements FinanceFilter {
  @ApiProperty({ example: '2026-01-01', description: 'Inicio do periodo (inclusivo)' })
  @IsISO8601({ strict: true }, { message: `de ${DATE_ISO}` })
  @Matches(DATE_FORMAT, { message: `de ${DATE_SHAPE}` })
  de: string;

  @ApiProperty({ example: '2026-01-31', description: 'Fim do periodo (inclusivo)' })
  @IsISO8601({ strict: true }, { message: `ate ${DATE_ISO}` })
  @Matches(DATE_FORMAT, { message: `ate ${DATE_SHAPE}` })
  ate: string;
}
