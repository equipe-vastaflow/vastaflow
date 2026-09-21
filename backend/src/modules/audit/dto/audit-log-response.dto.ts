import { ApiProperty } from '@nestjs/swagger';
import type { AuditLog, AuditMetadata } from '../entities/audit-log.entity';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  usuarioId: string | null;

  @ApiProperty({ example: 'LOGIN' })
  acao: string;

  @ApiProperty({ example: 'AUTH' })
  modulo: string;

  @ApiProperty({ example: 'Login realizado com sucesso' })
  descricao: string;

  @ApiProperty({ nullable: true, type: String, example: '127.0.0.1' })
  ip: string | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'Detalhes adicionais da operacao. Chaves sensiveis sao removidas antes da gravacao.',
    example: { motivo: 'CREDENCIAIS_INVALIDAS' },
  })
  metadados: AuditMetadata | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

export function toAuditLogResponse(log: AuditLog): AuditLogResponseDto {
  return {
    id: log.id,
    usuarioId: log.usuarioId,
    acao: log.acao,
    modulo: log.modulo,
    descricao: log.descricao,
    ip: log.ip,
    metadados: log.metadados,
    createdAt: log.createdAt,
  };
}
