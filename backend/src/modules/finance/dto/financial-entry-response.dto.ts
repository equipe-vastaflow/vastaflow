import { ApiProperty } from '@nestjs/swagger';
import type { UserIdentity } from '../../users/user-directory.service';
import type { FinancialEntry } from '../entities/financial-entry.entity';
import { FinancialEntryStatus, FinancialEntryType } from '../financial-entry.enums';

/** Quem criou o lancamento. */
export class EntryAuthorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Maria Silva' })
  nome: string;

  @ApiProperty({ example: 'maria@example.com' })
  email: string;
}

export class FinancialEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: FinancialEntryType })
  tipo: FinancialEntryType;

  @ApiProperty({ example: 'Compra de insumos' })
  descricao: string;

  @ApiProperty({
    example: 1500.5,
    description: 'Sempre positivo; o `tipo` define entrada ou saida',
  })
  valor: number;

  @ApiProperty({ example: '2026-09-23', description: 'Data do evento financeiro (YYYY-MM-DD)' })
  data: string;

  @ApiProperty({ example: 'Insumos' })
  categoria: string;

  @ApiProperty({ enum: FinancialEntryStatus })
  status: FinancialEntryStatus;

  @ApiProperty({ nullable: true, type: String, example: null })
  observacao: string | null;

  @ApiProperty({ format: 'uuid', description: 'Id de quem criou o lancamento' })
  criadoPorId: string;

  @ApiProperty({
    type: EntryAuthorDto,
    nullable: true,
    description:
      'Autor identificado. Nulo quando o usuario nao existe mais - `criadoPorId` continua preenchido.',
  })
  criadoPor: EntryAuthorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}

/** @param autor identidade ja resolvida em lote; `undefined` quando nao ha. */
export function toFinancialEntryResponse(
  entry: FinancialEntry,
  autor?: UserIdentity,
): FinancialEntryResponseDto {
  return {
    id: entry.id,
    tipo: entry.tipo,
    descricao: entry.descricao,
    valor: entry.valor,
    data: entry.data,
    categoria: entry.categoria,
    status: entry.status,
    observacao: entry.observacao,
    criadoPorId: entry.criadoPorId,
    criadoPor: autor ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
