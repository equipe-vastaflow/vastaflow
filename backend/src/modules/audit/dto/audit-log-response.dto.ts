import { ApiProperty } from '@nestjs/swagger';
import type { UserIdentity } from '../../users/user-directory.service';
import type { AuditLog, AuditMetadata } from '../entities/audit-log.entity';

/** Quem executou a acao, identificado por nome e e-mail. */
export class AuditActorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Maria Silva' })
  nome: string;

  @ApiProperty({ example: 'maria@example.com' })
  email: string;
}

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Id do responsavel. Mantido para quem ja o consumia.',
  })
  usuarioId: string | null;

  @ApiProperty({
    type: AuditActorDto,
    nullable: true,
    description:
      'Responsavel identificado. Nulo quando o evento nao tem usuario (ex.: login com ' +
      'e-mail inexistente) ou quando o usuario nao existe mais - neste caso `usuarioId` ' +
      'continua preenchido.',
  })
  usuario: AuditActorDto | null;

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

/** @param autor identidade ja resolvida em lote; `undefined` quando nao ha. */
export function toAuditLogResponse(log: AuditLog, autor?: UserIdentity): AuditLogResponseDto {
  return {
    id: log.id,
    usuarioId: log.usuarioId,
    usuario: autor ?? null,
    acao: log.acao,
    modulo: log.modulo,
    descricao: log.descricao,
    ip: log.ip,
    metadados: log.metadados,
    createdAt: log.createdAt,
  };
}
