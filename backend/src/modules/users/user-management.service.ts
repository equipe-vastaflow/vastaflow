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
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import { RolesService } from '../roles/roles.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { User } from './entities/user.entity';
import { canGrantRole, canManageUser, type RoleGrant } from './user-access.policy';
import { DuplicateEmailError, UsersRepository } from './users.repository';
import { normalizeEmail, UsersService } from './users.service';

export interface UserPage {
  items: User[];
  total: number;
}

const LAST_ADMIN_MESSAGE = 'Operacao recusada: o sistema precisa manter ao menos um ADMIN ativo';
const HIERARCHY_MESSAGE = 'Voce nao pode gerenciar um usuario com perfil igual ou superior ao seu';

/**
 * Administracao de usuarios (`/users`).
 *
 * As rotas ja passaram pelo `PermissionsGuard` (permissao granular). Aqui ficam
 * as regras que dependem do ALVO da operacao, que o guard nao conhece:
 *
 * 1. hierarquia (`user-access.policy.ts`): so se gerencia quem tem perfil
 *    abaixo do seu, e so se concede perfil abaixo do seu;
 * 2. ninguem altera o proprio status nem o proprio perfil;
 * 3. o sistema nunca fica sem ADMIN ativo (checado sob lock).
 *
 * Toda alteracao efetivada e registrada na auditoria. Operacoes que nao mudam
 * nada (ex.: ativar quem ja esta ativo) respondem normalmente e nao geram
 * registro, assim como tentativas recusadas (403/409).
 *
 * A auditoria e BEST-EFFORT (comportamento do `AuditService`): o registro e
 * gravado depois da alteracao, fora da transacao dela, e uma falha ao grava-lo
 * vai para o log da aplicacao sem desfazer a operacao nem mudar a resposta.
 * Portanto pode existir alteracao efetivada sem AuditLog correspondente.
 */
@Injectable()
export class UserManagementService {
  constructor(
    private readonly usersService: UsersService,
    private readonly usersRepository: UsersRepository,
    private readonly rolesService: RolesService,
    private readonly auditService: AuditService,
  ) {}

  async list(page: number, limit: number): Promise<UserPage> {
    const [items, total] = await this.usersRepository.findPage((page - 1) * limit, limit);
    return { items, total };
  }

  /** @throws NotFoundException */
  async get(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('Usuario nao encontrado');
    }
    return user;
  }

  /**
   * Perfis que o ator pode conceder - e, pela mesma regra, os perfis dos
   * usuarios que ele pode gerenciar. Existe para o frontend refletir as regras
   * do backend sem duplica-las.
   */
  async assignableRoles(actor: AuthenticatedUser): Promise<RoleName[]> {
    const grantable = new Set(
      (await this.rolesService.findAll())
        .filter((role) => canGrantRole(actor, toGrant(role)))
        .map((role) => role.nome),
    );
    return Object.values(RoleName).filter((nome) => grantable.has(nome));
  }

  /**
   * @throws ForbiddenException perfil acima do que o ator pode conceder.
   * @throws ConflictException e-mail ja cadastrado.
   */
  async create(actor: AuthenticatedUser, dto: CreateUserDto, ip: string | null): Promise<User> {
    const role = await this.rolesService.getByName(dto.role ?? RoleName.Usuario);
    if (!canGrantRole(actor, toGrant(role))) {
      throw new ForbiddenException(`Voce nao pode conceder o perfil ${role.nome}`);
    }

    const user = await this.usersService.create({
      nome: dto.nome,
      email: dto.email,
      senha: dto.senha,
      role: role.nome,
    });

    await this.record(actor, ip, AuditAction.UserCreated, `Usuario ${user.email} criado`, {
      alvoId: user.id,
      email: user.email,
      role: role.nome,
    });
    return user;
  }

  /**
   * Edita nome e e-mail. O proprio usuario pode editar os seus dados; os de
   * outro usuario exigem a regra de hierarquia.
   *
   * @throws NotFoundException | ForbiddenException | ConflictException (e-mail em uso)
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
    ip: string | null,
  ): Promise<User> {
    const target = this.requireManageable(actor, await this.usersRepository.findById(id));

    const alteracoes: Record<string, { de: string; para: string }> = {};
    if (dto.nome !== undefined && dto.nome !== target.nome) {
      alteracoes.nome = { de: target.nome, para: dto.nome };
    }
    const email = dto.email === undefined ? undefined : normalizeEmail(dto.email);
    if (email !== undefined && email !== target.email) {
      const owner = await this.usersRepository.findByEmail(email);
      if (owner && owner.id !== target.id) {
        throw new ConflictException('E-mail ja cadastrado');
      }
      alteracoes.email = { de: target.email, para: email };
    }

    if (Object.keys(alteracoes).length === 0) {
      return target;
    }

    // Gravacao DIRECIONADA: somente as colunas que esta operacao declara
    // alterar. Nao ha `save(entity)` aqui - uma entidade lida antes de uma
    // alteracao administrativa concorrente nao tem como reescrever `ativo`,
    // `role_id` ou `senha_hash`.
    const quando = new Date();
    let alcancadas: number;
    try {
      alcancadas = await this.usersRepository.updateFields(
        target.id,
        {
          ...(alteracoes.nome === undefined ? {} : { nome: alteracoes.nome.para }),
          ...(alteracoes.email === undefined ? {} : { email: alteracoes.email.para }),
        },
        quando,
      );
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        throw new ConflictException('E-mail ja cadastrado');
      }
      throw error;
    }
    if (alcancadas === 0) {
      // Conta apagada entre a leitura e a gravacao. O `save` antigo a
      // reinseriria; o UPDATE direcionado simplesmente nao alcanca nada.
      throw new NotFoundException('Usuario nao encontrado');
    }

    // As demais colunas nao foram tocadas, entao o resto de `target` continua
    // valendo para a resposta.
    target.nome = alteracoes.nome?.para ?? target.nome;
    target.email = alteracoes.email?.para ?? target.email;
    target.updatedAt = quando;

    // Os campos auditados sao exatamente os que o UPDATE citou: `alteracoes` e
    // a mesma fonte dos dois.
    await this.record(actor, ip, AuditAction.UserUpdated, `Usuario ${target.email} alterado`, {
      alvoId: target.id,
      alteracoes,
    });
    return target;
  }

  /**
   * Ativa ou desativa. Desativar tem efeito imediato: o `JwtAuthGuard` confere
   * o status a cada requisicao, entao os tokens ja emitidos param de valer.
   *
   * @throws NotFoundException | ForbiddenException | ConflictException (ultimo ADMIN)
   */
  async setStatus(
    actor: AuthenticatedUser,
    id: string,
    ativo: boolean,
    ip: string | null,
  ): Promise<User> {
    const result = await this.usersRepository.runLockedAdminChange(id, async (change) => {
      const target = this.requireManageable(actor, change.target);

      if (!ativo && removesActiveAdmin(target, change.activeAdminCount)) {
        throw new ConflictException(LAST_ADMIN_MESSAGE);
      }
      if (target.id === actor.id) {
        throw new ForbiddenException('Voce nao pode alterar o proprio status');
      }
      if (target.ativo === ativo) {
        return { user: target, changed: false };
      }

      target.ativo = ativo;
      return { user: await change.save(target), changed: true };
    });

    if (result.changed) {
      await this.record(
        actor,
        ip,
        ativo ? AuditAction.UserActivated : AuditAction.UserDeactivated,
        `Usuario ${result.user.email} ${ativo ? 'ativado' : 'desativado'}`,
        { alvoId: result.user.id },
      );
    }
    return result.user;
  }

  /**
   * Troca o perfil. Vale imediatamente: o perfil e relido do banco a cada
   * requisicao, nao fica no JWT.
   *
   * @throws NotFoundException | ForbiddenException | ConflictException (ultimo ADMIN)
   */
  async setRole(
    actor: AuthenticatedUser,
    id: string,
    roleName: RoleName,
    ip: string | null,
  ): Promise<User> {
    const role = await this.rolesService.getByName(roleName);

    const result = await this.usersRepository.runLockedAdminChange(id, async (change) => {
      const target = this.requireManageable(actor, change.target);
      const previous = target.role.nome;

      if (!canGrantRole(actor, toGrant(role))) {
        throw new ForbiddenException(`Voce nao pode conceder o perfil ${role.nome}`);
      }
      if (role.nome !== RoleName.Admin && removesActiveAdmin(target, change.activeAdminCount)) {
        throw new ConflictException(LAST_ADMIN_MESSAGE);
      }
      if (target.id === actor.id) {
        throw new ForbiddenException('Voce nao pode alterar o proprio perfil');
      }
      if (previous === role.nome) {
        return { user: target, previous, changed: false };
      }

      target.role = role;
      return { user: await change.save(target), previous, changed: true };
    });

    if (result.changed) {
      await this.record(
        actor,
        ip,
        AuditAction.UserRoleChanged,
        `Perfil de ${result.user.email} alterado de ${result.previous} para ${role.nome}`,
        { alvoId: result.user.id, de: result.previous, para: role.nome },
      );
    }
    return result.user;
  }

  /**
   * Alvo existente e ao alcance do ator. O proprio usuario passa por aqui: as
   * regras especificas de auto-alteracao ficam em cada operacao.
   */
  private requireManageable(actor: AuthenticatedUser, target: User | null): User {
    if (!target) {
      throw new NotFoundException('Usuario nao encontrado');
    }
    if (target.id !== actor.id && !canManageUser(actor, toGrant(target.role))) {
      throw new ForbiddenException(HIERARCHY_MESSAGE);
    }
    return target;
  }

  private record(
    actor: AuthenticatedUser,
    ip: string | null,
    acao: AuditAction,
    descricao: string,
    metadados: AuditMetadata,
  ): Promise<void> {
    return this.auditService.record({
      usuarioId: actor.id,
      acao,
      modulo: AuditModuleName.Users,
      descricao: `${descricao} por ${actor.email}`,
      ip,
      metadados,
    });
  }
}

function toGrant(role: Role): RoleGrant {
  return { nome: role.nome, permissions: role.permissions.map((permission) => permission.code) };
}

/** O alvo e ADMIN ativo e nao ha outro ADMIN ativo alem dele. */
function removesActiveAdmin(target: User, activeAdminCount: number): boolean {
  return target.ativo && target.role.nome === RoleName.Admin && activeAdminCount <= 1;
}
