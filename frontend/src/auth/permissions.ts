import type { User } from '../api/client';

/** Codigos de permissao usados pelo frontend (espelham o catalogo do backend). */
export const Permission = {
  UsersRead: 'users:read',
  UsersCreate: 'users:create',
  UsersUpdate: 'users:update',
  UsersStatus: 'users:status',
  UsersRole: 'users:role',
} as const;

export type PermissionCode = (typeof Permission)[keyof typeof Permission];

/**
 * Mesma regra do `PermissionsGuard` do backend: ADMIN tem acesso total; os
 * demais precisam da permissao no perfil.
 *
 * Serve APENAS para decidir o que mostrar. Quem autoriza e o backend - toda
 * operacao e checada de novo no servidor, com as permissoes lidas do banco.
 */
export function hasPermission(user: User | null, permission: PermissionCode): boolean {
  return user !== null && (user.role === 'ADMIN' || user.permissions.includes(permission));
}
