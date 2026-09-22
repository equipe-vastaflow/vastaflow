import { ApiProperty } from '@nestjs/swagger';
import { AuditLogResponseDto } from './audit-log-response.dto';

export class AuditLogPageResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto], description: 'Os mais recentes primeiro' })
  items: AuditLogResponseDto[];

  @ApiProperty({ example: 128, description: 'Total de eventos, em todas as paginas' })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
