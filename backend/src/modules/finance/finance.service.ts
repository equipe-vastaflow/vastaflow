import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import type { AuditMetadata } from '../audit/entities/audit-log.entity';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UserDirectoryService, type UserIdentity } from '../users/user-directory.service';
import type { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import type { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import type { FinancialEntry } from './entities/financial-entry.entity';
import {
  allowedTransitionsFrom,
  canTransition,
  isFrozen,
  rejectedEdits,
} from './entry-status.policy';
import { FinancialEntryStatus } from './financial-entry.enums';
import { FinanceRepository } from './finance.repository';

/** Lancamento com o autor ja resolvido. `autor` ausente = usuario nao existe mais. */
export interface EntryWithAuthor {
  entry: FinancialEntry;
  autor?: UserIdentity;
}

export interface FinancialEntryPage {
  items: EntryWithAuthor[];
  total: number;
}

/** Resumo usado pelo comando `/financeiro`. */
export interface FinanceOverview {
  total: number;
  recentes: FinancialEntry[];
}

/** Quantos lancamentos o resumo do comando mostra. */
export const OVERVIEW_LIMIT = 5;

/**
 * Regras do dominio financeiro.
 *
 * As rotas ja passaram pelo `PermissionsGuard` (permissao granular). Aqui ficam
 * as regras que o guard nao conhece: existencia do lancamento e transicoes de
 * status validas.
 *
 * O autor do lancamento e SEMPRE o usuario autenticado recebido como `actor` -
 * nenhum identificador de usuario vindo do cliente e aceito.
 *
 * A auditoria e BEST-EFFORT, como no restante do sistema: o registro e gravado
 * depois da alteracao e uma falha ao grava-lo vai para o log sem desfazer a
 * operacao nem mudar a resposta. Operacoes sem efeito (ex.: repetir o status
 * atual) respondem normalmente e nao geram registro.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly userDirectory: UserDirectoryService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Pagina de lancamentos com o autor de cada um.
   *
   * Duas consultas por pagina, sempre: a pagina (com `COUNT`) e UMA busca em
   * lote dos autores - nunca uma consulta por lancamento.
   */
  async list(page: number, limit: number): Promise<FinancialEntryPage> {
    const [entries, total] = await this.repository.findPage((page - 1) * limit, limit);
    return { items: await this.withAuthors(entries), total };
  }

  /** @throws NotFoundException */
  async get(id: string): Promise<EntryWithAuthor> {
    const entry = await this.findOrFail(id);
    return this.withAuthor(entry);
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateFinancialEntryDto,
    ip: string | null,
  ): Promise<EntryWithAuthor> {
    const entry = await this.repository.create({
      tipo: dto.tipo,
      descricao: dto.descricao,
      valor: dto.valor,
      data: dto.data,
      categoria: dto.categoria,
      // Todo lancamento nasce PENDENTE; o status muda por rota propria.
      status: FinancialEntryStatus.Pendente,
      observacao: dto.observacao ?? null,
      criadoPorId: actor.id,
    });

    await this.audit(actor, AuditAction.FinanceEntryCreated, entry, ip, {
      alvoId: entry.id,
      tipo: entry.tipo,
      status: entry.status,
    });

    return { entry, autor: toIdentity(actor) };
  }

  /**
   * Edita os dados do lancamento. Nao altera status nem autor.
   *
   * @throws NotFoundException
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateFinancialEntryDto,
    ip: string | null,
  ): Promise<EntryWithAuthor> {
    const entry = await this.findOrFail(id);

    const alterados = Object.keys(dto).filter(
      (campo) => dto[campo as keyof UpdateFinancialEntryDto] !== undefined,
    );
    if (alterados.length === 0) {
      // Nada enviado: responde o estado atual, sem gravar nem auditar.
      return this.get(id);
    }

    // Integridade do fato financeiro: um lancamento PAGO nao muda de valor nem
    // de data, e um CANCELADO nao muda em nada. A recusa acontece ANTES de
    // gravar, entao nao ha alteracao no banco nem registro de auditoria.
    const recusados = rejectedEdits(entry.status, alterados);
    if (recusados.length > 0) {
      throw new ConflictException(
        isFrozen(entry.status)
          ? `Lancamento ${entry.status} nao pode ser alterado`
          : `Lancamento ${entry.status} nao permite alterar: ${recusados.join(', ')}`,
      );
    }

    Object.assign(entry, dto);
    const salvo = await this.repository.save(entry);

    await this.audit(actor, AuditAction.FinanceEntryUpdated, salvo, ip, {
      alvoId: salvo.id,
      // Apenas os NOMES dos campos alterados - nunca os valores, que sao dados
      // de negocio e nao pertencem a trilha de auditoria.
      campos: alterados,
    });

    return this.withAuthor(salvo);
  }

  /**
   * Altera o status respeitando as transicoes permitidas.
   *
   * @throws NotFoundException lancamento inexistente.
   * @throws ConflictException transicao nao permitida.
   */
  async changeStatus(
    actor: AuthenticatedUser,
    id: string,
    status: FinancialEntryStatus,
    ip: string | null,
  ): Promise<EntryWithAuthor> {
    const entry = await this.findOrFail(id);

    if (entry.status === status) {
      // Sem efeito: responde normalmente e nao audita.
      return this.get(id);
    }

    if (!canTransition(entry.status, status)) {
      const destinos = allowedTransitionsFrom(entry.status);
      throw new ConflictException(
        destinos.length === 0
          ? `Lancamento ${entry.status} nao pode mudar de status`
          : `Transicao ${entry.status} -> ${status} nao permitida. Destinos validos: ${destinos.join(', ')}`,
      );
    }

    const anterior = entry.status;
    entry.status = status;
    const salvo = await this.repository.save(entry);

    await this.audit(actor, AuditAction.FinanceEntryStatusChanged, salvo, ip, {
      alvoId: salvo.id,
      de: anterior,
      para: salvo.status,
    });

    return this.withAuthor(salvo);
  }

  /**
   * Resumo para o comando `/financeiro`: total de lancamentos e os mais
   * recentes. Dados reais do banco - nao ha valor calculado nem estimado.
   */
  async overview(): Promise<FinanceOverview> {
    const [total, recentes] = await Promise.all([
      this.repository.count(),
      this.repository.findLatest(OVERVIEW_LIMIT),
    ]);
    return { total, recentes };
  }

  private async findOrFail(id: string): Promise<FinancialEntry> {
    const entry = await this.repository.findById(id);
    if (!entry) {
      throw new NotFoundException('Lancamento nao encontrado');
    }
    return entry;
  }

  private async withAuthor(entry: FinancialEntry): Promise<EntryWithAuthor> {
    const [item] = await this.withAuthors([entry]);
    return item;
  }

  /** Resolve os autores em UMA consulta, nunca uma por lancamento. */
  private async withAuthors(entries: FinancialEntry[]): Promise<EntryWithAuthor[]> {
    const autores = await this.userDirectory.findByIds(entries.map((entry) => entry.criadoPorId));
    return entries.map((entry) => ({ entry, autor: autores.get(entry.criadoPorId) }));
  }

  private audit(
    actor: AuthenticatedUser,
    acao: AuditAction,
    entry: FinancialEntry,
    ip: string | null,
    metadados: AuditMetadata,
  ): Promise<void> {
    return this.auditService.record({
      usuarioId: actor.id,
      acao,
      modulo: AuditModuleName.Finance,
      // Sem valor monetario e sem a descricao do lancamento: o id identifica o
      // registro, e quem tem `finance:read` consulta o resto pela API.
      descricao: `Lancamento ${entry.id} por ${actor.email}`,
      ip,
      metadados,
    });
  }
}

function toIdentity(actor: AuthenticatedUser): UserIdentity {
  return { id: actor.id, nome: actor.nome, email: actor.email };
}
