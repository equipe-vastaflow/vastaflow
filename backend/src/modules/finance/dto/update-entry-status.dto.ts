import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { FinancialEntryStatus } from '../financial-entry.enums';

export class UpdateEntryStatusDto {
  @ApiProperty({
    enum: FinancialEntryStatus,
    example: FinancialEntryStatus.Pago,
    description:
      'Novo status. Transicoes permitidas: PENDENTE -> PAGO | CANCELADO, PAGO -> CANCELADO. ' +
      'CANCELADO e terminal.',
  })
  @IsEnum(FinancialEntryStatus, {
    message: `status deve ser um destes valores: ${Object.values(FinancialEntryStatus).join(', ')}`,
  })
  status: FinancialEntryStatus;
}
