import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuditLog } from '../audit/entities/audit-log.entity';
import type { AuthenticatedUser } from '../auth/auth.types';
import { hasPermission } from '../auth/has-permission';
import { PermissionCode } from '../permissions/permission-code.enum';
import { UsersService } from '../users/users.service';
import type {
  AuditSummaryDto,
  DashboardAuditEventDto,
  DashboardSummaryResponseDto,
} from './dto/dashboard-summary-response.dto';

/** Quantos eventos recentes o dashboard mostra. */
export const RECENT_AUDIT_LIMIT = 10;

/**
 * Monta o resumo do dashboard a partir dos modulos que ja existem.
 *
 * Somente leitura: nao grava auditoria (abrir o dashboard nao e uma acao
 * auditavel) e nao altera nada.
 *
 * Cada secao depende da permissao correspondente, avaliada com a mesma funcao
 * que o `PermissionsGuard` usa. Sem a permissao, a secao simplesmente nao vem -
 * nada e consultado no banco a toa.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  async getSummary(actor: AuthenticatedUser): Promise<DashboardSummaryResponseDto> {
    // As duas secoes sao independentes: consultadas em paralelo.
    const [usuarios, auditoria] = await Promise.all([
      hasPermission(actor, PermissionCode.UsersRead)
        ? this.usersService.countByStatus()
        : undefined,
      hasPermission(actor, PermissionCode.AuditRead) ? this.buildAuditSummary() : undefined,
    ]);

    return {
      ...(usuarios ? { usuarios } : {}),
      ...(auditoria ? { auditoria } : {}),
    };
  }

  private async buildAuditSummary(): Promise<AuditSummaryDto> {
    const [total, recentes] = await Promise.all([
      this.auditService.count(),
      this.auditService.findLatest(RECENT_AUDIT_LIMIT),
    ]);

    return { total, recentes: await this.withActorNames(recentes) };
  }

  /**
   * Resolve o nome dos autores numa UNICA consulta (`WHERE id IN (...)`), e nao
   * uma por evento. `audit_logs.usuario_id` nao tem chave estrangeira de
   * proposito - a trilha sobrevive ao usuario -, entao nao ha relacao para o
   * TypeORM carregar junto.
   */
  private async withActorNames(logs: AuditLog[]): Promise<DashboardAuditEventDto[]> {
    const ids = logs.map((log) => log.usuarioId).filter((id): id is string => id !== null);
    const names = await this.usersService.findNamesByIds(ids);

    return logs.map((log) => {
      const nome = log.usuarioId === null ? undefined : names.get(log.usuarioId);
      return {
        id: log.id,
        acao: log.acao,
        modulo: log.modulo,
        descricao: log.descricao,
        usuario: log.usuarioId !== null && nome !== undefined ? { id: log.usuarioId, nome } : null,
        createdAt: log.createdAt,
      };
    });
  }
}
