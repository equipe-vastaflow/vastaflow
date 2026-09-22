import type { PermissionCode } from '../permissions/permission-code.enum';
import { RoleName } from '../roles/role-name.enum';
import type { AuthenticatedUser } from './auth.types';

/**
 * Regra unica de autorizacao por permissao: ADMIN tem acesso total; os demais
 * precisam da permissao no perfil.
 *
 * Usada pelo `PermissionsGuard` (que barra a requisicao) e por quem precisa
 * decidir o que devolver dentro de uma resposta - o `DashboardService` monta o
 * resumo so com as secoes que o solicitante pode ver. Manter uma funcao so
 * evita que as duas regras divirjam.
 */
export function hasPermission(
  user: AuthenticatedUser | undefined,
  permission: PermissionCode,
): boolean {
  if (!user) {
    return false;
  }
  return user.role === RoleName.Admin || user.permissions.includes(permission);
}
