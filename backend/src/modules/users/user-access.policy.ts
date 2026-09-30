import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';

/** O que a politica precisa saber de quem executa a operacao. */
export interface Actor {
  id: string;
  role: RoleName;
  permissions: string[];
}

/** Perfil a conceder, ou perfil atual do usuario-alvo. */
export interface RoleGrant {
  nome: RoleName;
  permissions: string[];
}

/**
 * Regra de hierarquia da administracao de usuarios.
 *
 * O ator pode conceder o perfil (e gerenciar quem o possui) somente quando as
 * permissoes do perfil formam um subconjunto ESTRITO das suas. Consequencias:
 *
 * - ninguem concede uma permissao que nao possui (nem a si mesmo);
 * - ninguem gerencia um par (GESTOR nao altera outro GESTOR) nem um superior;
 * - ADMIN e tratado pelo nome, nao pelas permissoes gravadas no banco: o
 *   `PermissionsGuard` libera ADMIN incondicionalmente, entao so outro ADMIN
 *   pode conceder esse perfil ou gerenciar quem o possui.
 *
 * O vinculo perfil/permissao vive no banco, entao a regra acompanha qualquer
 * ajuste feito nele sem mudar o codigo.
 */
export function canGrantRole(actor: Actor, role: RoleGrant): boolean {
  if (actor.role === RoleName.Admin) {
    return true;
  }
  if (role.nome === RoleName.Admin) {
    return false;
  }

  const actorPermissions = new Set(actor.permissions);
  const rolePermissions = new Set(role.permissions);
  return (
    [...rolePermissions].every((permission) => actorPermissions.has(permission)) &&
    rolePermissions.size < actorPermissions.size
  );
}

/** Gerenciar um usuario exige poder conceder o perfil que ele tem hoje. */
export function canManageUser(actor: Actor, targetRole: RoleGrant): boolean {
  return canGrantRole(actor, targetRole);
}

/** O perfil carregado do banco no formato que a politica avalia. */
export function toRoleGrant(role: Role): RoleGrant {
  return { nome: role.nome, permissions: role.permissions.map((permission) => permission.code) };
}
