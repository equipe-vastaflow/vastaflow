import type { RoleName, User } from '../../api/client';
import { hasPermission, Permission } from '../../auth/permissions';

export interface UserCapabilities {
  edit: boolean;
  toggleStatus: boolean;
  changeRole: boolean;
}

/**
 * O que a interface oferece para `target`, a partir das permissoes de `me` e
 * dos perfis que o backend diz que `me` pode conceder (`assignable`).
 *
 * Espelha as regras do backend sem reimplementa-las: a hierarquia chega pronta
 * em `assignable` (quem gerencia um usuario e quem pode conceder o perfil dele).
 * Esconder um botao aqui nao protege nada - o backend recusa a operacao de
 * qualquer forma.
 */
export function userCapabilities(me: User, target: User, assignable: RoleName[]): UserCapabilities {
  const self = me.id === target.id;
  const manageable = assignable.includes(target.role);
  const otherRoles = assignable.filter((role) => role !== target.role);

  return {
    // Os proprios dados podem ser editados por quem tem `users:update`.
    edit: hasPermission(me, Permission.UsersUpdate) && (self || manageable),
    toggleStatus: hasPermission(me, Permission.UsersStatus) && !self && manageable,
    changeRole:
      hasPermission(me, Permission.UsersRole) && !self && manageable && otherRoles.length > 0,
  };
}
