import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import type { AuditMetadata } from '../audit/entities/audit-log.entity';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { User } from '../users/entities/user.entity';
import { canManageUser, toRoleGrant } from '../users/user-access.policy';
import { UsersService } from '../users/users.service';
import type { ExternalIdentityLink } from './entities/external-identity-link.entity';
import type { IdentityLinkRequest } from './entities/identity-link-request.entity';
import { ExternalIdentitiesRepository } from './external-identities.repository';
import {
  type IdentityChannel,
  LINK_REQUEST_TTL_MS,
  LinkRequestStatus,
} from './external-identity.enums';
import {
  DuplicatePendingRequestError,
  IdentityLinkRequestsRepository,
} from './identity-link-requests.repository';
import { generateLinkCode, hashLinkCode, normalizeLinkCode } from './link-code';

const HIERARCHY_MESSAGE = 'Voce nao pode gerenciar um usuario com perfil igual ou superior ao seu';
const NOT_FOUND = 'Usuario nao encontrado';

/** Solicitacao recem-criada, com o codigo em claro - a UNICA vez que ele existe. */
export interface CreatedLinkRequest {
  request: IdentityLinkRequest;
  codigo: string;
}

/**
 * Vinculos de identidade externa (`/users/:id/external-identities`).
 *
 * A API interna NAO cria vinculo ativo. Ela inicia uma SOLICITACAO: gera um
 * codigo de uso unico, com validade curta, para o usuario-alvo. O vinculo so
 * nasce quando a propria conta externa envia esse codigo (`LinkConfirmationService`)
 * - e e dai que sai o id externo. Ninguem escolhe qual conta do Telegram passa a
 * representar o usuario: a conta prova a posse enviando o codigo.
 *
 * Quem administra: `users:update`, com a MESMA hierarquia da edicao de usuarios
 * (`canManageUser`). O vinculo ativo nao carrega perfil nem permissao: quem
 * entra pelo canal age com o perfil ATUAL do usuario.
 *
 * Auditoria: solicitacao criada, solicitacao cancelada e vinculo removido
 * (o vinculo confirmado e auditado na confirmacao). O codigo nunca entra.
 */
@Injectable()
export class ExternalIdentitiesService {
  constructor(
    private readonly links: ExternalIdentitiesRepository,
    private readonly requests: IdentityLinkRequestsRepository,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  /** Vinculos ATIVOS do usuario. @throws NotFoundException */
  async list(userId: string): Promise<ExternalIdentityLink[]> {
    await this.requireUser(userId);
    return this.links.findByUser(userId);
  }

  /** Solicitacoes pendentes do usuario, sem o codigo. @throws NotFoundException */
  async listPendingRequests(userId: string): Promise<IdentityLinkRequest[]> {
    await this.requireUser(userId);
    return this.requests.findPendingByUser(userId);
  }

  /**
   * Inicia a vinculacao: cria uma solicitacao pendente e devolve o codigo.
   *
   * No maximo UMA pendente por usuario e canal, garantido no banco. Uma pendente
   * ja vencida e encerrada (`EXPIRADA`) para dar lugar a nova; uma ainda valida
   * responde 409 - cancele-a primeiro. Dois pedidos simultaneos: um passa, o
   * outro cai no indice e tambem responde 409.
   *
   * @throws NotFoundException | ForbiddenException (hierarquia)
   * @throws ConflictException usuario inativo, ou ja ha solicitacao pendente valida
   */
  async requestLink(
    actor: AuthenticatedUser,
    userId: string,
    canal: IdentityChannel,
    ip: string | null,
  ): Promise<CreatedLinkRequest> {
    const target = this.requireManageable(actor, await this.usersService.findById(userId));
    if (!target.ativo) {
      throw new ConflictException('Usuario inativo nao pode receber vinculo');
    }

    const anterior = await this.requests.findPending(target.id, canal);
    if (anterior) {
      if (anterior.expiraEm.getTime() > Date.now()) {
        throw new ConflictException('Ja existe uma solicitacao pendente para este usuario');
      }
      await this.requests.close(anterior.id, target.id, LinkRequestStatus.Expirada);
    }

    const codigo = generateLinkCode();
    let request: IdentityLinkRequest;
    try {
      request = await this.requests.create({
        canal,
        usuarioId: target.id,
        // So o hash vai para o banco; `normalizeLinkCode` nunca falha num codigo gerado.
        codigoHash: hashLinkCode(normalizeLinkCode(codigo) as string),
        expiraEm: new Date(Date.now() + LINK_REQUEST_TTL_MS),
        criadoPorId: actor.id,
      });
    } catch (error) {
      if (error instanceof DuplicatePendingRequestError) {
        throw new ConflictException('Ja existe uma solicitacao pendente para este usuario');
      }
      throw error;
    }

    await this.record(actor, ip, AuditAction.ExternalIdentityLinkRequested, target, {
      alvoId: target.id,
      solicitacaoId: request.id,
      canal,
      expiraEm: request.expiraEm.toISOString(),
    });
    return { request, codigo };
  }

  /**
   * Cancela uma solicitacao pendente do usuario. Depois disso o codigo nao vale.
   *
   * @throws NotFoundException usuario inexistente, ou solicitacao inexistente,
   *   de outro usuario ou ja encerrada
   * @throws ForbiddenException hierarquia
   */
  async cancelRequest(
    actor: AuthenticatedUser,
    userId: string,
    requestId: string,
    ip: string | null,
  ): Promise<void> {
    const target = this.requireManageable(actor, await this.usersService.findById(userId));

    // `usuario_id` e `status` no WHERE: nao alcanca solicitacao de outra pessoa.
    if ((await this.requests.close(requestId, target.id, LinkRequestStatus.Cancelada)) === 0) {
      throw new NotFoundException('Solicitacao nao encontrada');
    }

    await this.record(actor, ip, AuditAction.ExternalIdentityLinkRequestCancelled, target, {
      alvoId: target.id,
      solicitacaoId: requestId,
    });
  }

  /**
   * Remove um vinculo ativo. Vale na proxima mensagem: nao ha cache.
   *
   * @throws NotFoundException usuario inexistente, ou vinculo inexistente/de outro usuario
   * @throws ForbiddenException hierarquia
   */
  async unlink(
    actor: AuthenticatedUser,
    userId: string,
    linkId: string,
    ip: string | null,
  ): Promise<void> {
    const target = this.requireManageable(actor, await this.usersService.findById(userId));

    // O vinculo precisa ser DESTE usuario: o id de um vinculo de outra pessoa na
    // rota de um usuario gerenciavel responde 404, igual a um id inexistente.
    const link = await this.links.findByIdForUser(linkId, target.id);
    if (!link || (await this.links.deleteForUser(linkId, target.id)) === 0) {
      throw new NotFoundException('Vinculo nao encontrado');
    }

    await this.record(actor, ip, AuditAction.ExternalIdentityUnlinked, target, {
      alvoId: target.id,
      vinculoId: link.id,
      canal: link.canal,
      idExterno: link.idExterno,
    });
  }

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.usersService.findById(userId))) {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  /** Mesma regra do `UserManagementService`: alvo existente e ao alcance do ator. */
  private requireManageable(actor: AuthenticatedUser, target: User | null): User {
    if (!target) {
      throw new NotFoundException(NOT_FOUND);
    }
    if (target.id !== actor.id && !canManageUser(actor, toRoleGrant(target.role))) {
      throw new ForbiddenException(HIERARCHY_MESSAGE);
    }
    return target;
  }

  /** So metadados de identificacao. Codigo, hash, token e mensagens nunca entram. */
  private record(
    actor: AuthenticatedUser,
    ip: string | null,
    acao: AuditAction,
    target: User,
    metadados: AuditMetadata,
  ): Promise<void> {
    return this.auditService.record({
      usuarioId: actor.id,
      acao,
      modulo: AuditModuleName.Users,
      descricao: `${DESCRIPTIONS[acao] ?? acao} de ${target.email} por ${actor.email}`,
      ip,
      metadados,
    });
  }
}

const DESCRIPTIONS: Partial<Record<AuditAction, string>> = {
  [AuditAction.ExternalIdentityLinkRequested]: 'Solicitacao de vinculo de identidade externa',
  [AuditAction.ExternalIdentityLinkRequestCancelled]:
    'Solicitacao de vinculo de identidade externa cancelada',
  [AuditAction.ExternalIdentityUnlinked]: 'Identidade externa desvinculada',
};
