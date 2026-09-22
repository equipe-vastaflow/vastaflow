import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditModuleName } from './audit-action.enum';
import { sanitizeAuditMetadata } from './audit-metadata';
import { AuditRepository } from './audit.repository';
import type { AuditLog, AuditMetadata } from './entities/audit-log.entity';

export interface AuditEvent {
  /** Ausente quando nao ha usuario identificado (ex.: e-mail inexistente no login). */
  usuarioId?: string;
  acao: AuditAction;
  modulo: AuditModuleName;
  descricao: string;
  ip?: string | null;
  /**
   * Detalhes adicionais da operacao. Chaves sensiveis (senha, token...) sao
   * removidas e o tamanho e limitado - ver `sanitizeAuditMetadata`.
   */
  metadados?: AuditMetadata;
}

/** Tamanho da coluna `descricao`; textos maiores sao truncados, nao rejeitados. */
const DESCRIPTION_MAX_LENGTH = 500;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly auditRepository: AuditRepository) {}

  /**
   * Registra um evento de auditoria.
   *
   * Uma falha ao gravar o log NAO derruba a operacao auditada: ela e registrada
   * no log da aplicacao e o fluxo segue. Se a politica da empresa exigir que a
   * acao so ocorra quando a auditoria for gravada, troque este `catch` por um
   * `throw`.
   */
  async record(event: AuditEvent): Promise<void> {
    try {
      await this.auditRepository.create({
        usuarioId: event.usuarioId ?? null,
        acao: event.acao,
        modulo: event.modulo,
        descricao: event.descricao.slice(0, DESCRIPTION_MAX_LENGTH),
        ip: event.ip ?? null,
        metadados: sanitizeAuditMetadata(event.metadados),
      });
    } catch (error) {
      this.logger.error(
        `Falha ao gravar auditoria ${event.modulo}/${event.acao}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  findLatest(limit: number): Promise<AuditLog[]> {
    return this.auditRepository.findLatest(limit);
  }

  /** Total de eventos registrados. */
  count(): Promise<number> {
    return this.auditRepository.count();
  }
}
