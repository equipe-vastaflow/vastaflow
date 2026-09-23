import { PartialType, PickType } from '@nestjs/swagger';
import { CreateFinancialEntryDto } from './create-financial-entry.dto';

/**
 * Edicao de um lancamento.
 *
 * Todos os campos sao opcionais, mas as mesmas regras do cadastro valem para os
 * enviados. `status` NAO entra aqui: ele muda por
 * `PATCH /finance/entries/:id/status`, que aplica as transicoes permitidas.
 * `criadoPorId` tambem nao: o autor original nao se altera.
 *
 * O `ValidationPipe` global roda com `forbidNonWhitelisted`, entao mandar
 * `status` ou qualquer campo fora desta lista resulta em 400.
 */
export class UpdateFinancialEntryDto extends PartialType(
  PickType(CreateFinancialEntryDto, [
    'tipo',
    'descricao',
    'valor',
    'data',
    'categoria',
    'observacao',
  ] as const),
) {}
