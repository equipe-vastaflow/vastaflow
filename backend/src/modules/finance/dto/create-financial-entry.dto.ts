import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FinancialEntryType } from '../financial-entry.enums';
import { MONEY_MAX, MONEY_MIN, MONEY_SCALE } from '../money.transformer';
import { TrimString } from './finance-fields';

/** `YYYY-MM-DD`, sem hora e sem fuso - o dia do evento financeiro. */
export const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export class CreateFinancialEntryDto {
  @ApiProperty({ enum: FinancialEntryType, example: FinancialEntryType.Despesa })
  @IsEnum(FinancialEntryType, {
    message: `tipo deve ser um destes valores: ${Object.values(FinancialEntryType).join(', ')}`,
  })
  tipo: FinancialEntryType;

  @ApiProperty({ example: 'Compra de insumos', maxLength: 200 })
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'Informe a descricao' })
  @MaxLength(200)
  descricao: string;

  @ApiProperty({
    example: 1500.5,
    minimum: MONEY_MIN,
    maximum: MONEY_MAX,
    description: 'Sempre positivo. Quem define entrada ou saida e o `tipo`.',
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: MONEY_SCALE, allowNaN: false, allowInfinity: false },
    { message: `valor deve ser um numero com no maximo ${MONEY_SCALE} casas decimais` },
  )
  @Min(MONEY_MIN, { message: 'valor deve ser maior que zero' })
  @Max(MONEY_MAX)
  valor: number;

  @ApiProperty({ example: '2026-09-23', description: 'Data do evento financeiro (YYYY-MM-DD)' })
  @IsISO8601({ strict: true }, { message: 'data deve ser uma data valida no formato YYYY-MM-DD' })
  @Matches(DATE_FORMAT, { message: 'data deve estar no formato YYYY-MM-DD, sem hora' })
  data: string;

  @ApiProperty({ example: 'Insumos', maxLength: 60 })
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'Informe a categoria' })
  @MaxLength(60)
  categoria: string;

  @ApiPropertyOptional({ example: 'Pagamento combinado para o dia 30', maxLength: 500 })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'observacao nao pode ser apenas espacos' })
  @MaxLength(500)
  observacao?: string;
}
