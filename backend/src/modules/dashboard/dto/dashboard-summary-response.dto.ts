import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserCountsDto {
  @ApiProperty({ example: 12, description: 'Usuarios cadastrados' })
  total: number;

  @ApiProperty({ example: 10 })
  ativos: number;

  @ApiProperty({ example: 2 })
  inativos: number;
}

/** Autor de um evento. Ausente em eventos sem usuario identificado. */
export class AuditActorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Maria Silva' })
  nome: string;
}

/**
 * Evento de auditoria reduzido ao que o dashboard mostra.
 *
 * Deliberadamente SEM `ip` e SEM `metadados`: nenhum dos dois e exibido no
 * dashboard, e nao ha motivo para trafegar mais do que o necessario. Quem
 * precisa do registro completo usa `GET /audit-logs`.
 */
export class DashboardAuditEventDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LOGIN' })
  acao: string;

  @ApiProperty({ example: 'AUTH' })
  modulo: string;

  @ApiProperty({ example: 'Login realizado por maria@example.com' })
  descricao: string;

  @ApiProperty({
    type: AuditActorDto,
    nullable: true,
    description:
      'Usuario responsavel. Nulo quando o evento nao tem usuario (ex.: login com e-mail ' +
      'inexistente) ou quando o registro do usuario nao existe mais.',
  })
  usuario: AuditActorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

export class AuditSummaryDto {
  @ApiProperty({ example: 128, description: 'Total de eventos registrados' })
  total: number;

  @ApiProperty({ type: [DashboardAuditEventDto], description: 'Os mais recentes primeiro' })
  recentes: DashboardAuditEventDto[];
}

/**
 * Resumo do dashboard.
 *
 * Cada secao so aparece para quem tem a permissao correspondente - nao ha
 * permissao propria de dashboard. Um perfil sem nenhuma delas recebe `{}` com
 * status 200: a pagina existe para todo usuario autenticado, apenas sem
 * indicadores.
 *
 * Contem SOMENTE dados que existem no banco hoje (usuarios e auditoria).
 * Financeiro, automacoes e integracoes entrarao como novas secoes opcionais
 * quando esses modulos existirem - por isso nenhum campo e inventado aqui.
 */
export class DashboardSummaryResponseDto {
  @ApiPropertyOptional({
    type: UserCountsDto,
    description: 'Presente com a permissao `users:read`',
  })
  usuarios?: UserCountsDto;

  @ApiPropertyOptional({
    type: AuditSummaryDto,
    description: 'Presente com a permissao `audit:read`',
  })
  auditoria?: AuditSummaryDto;
}
