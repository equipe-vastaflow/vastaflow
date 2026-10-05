import { PermissionCode } from '../permissions/permission-code.enum';
import { RoleName } from './role-name.enum';

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  [RoleName.Admin]: 'Acesso total ao sistema',
  [RoleName.Gestor]: 'Acesso administrativo limitado',
  [RoleName.Operador]: 'Executa as operacoes permitidas',
  [RoleName.Usuario]: 'Acesso basico',
};

/**
 * Permissoes que cada perfil recebe quando e criado.
 *
 * Sao apenas o ponto de partida: o seeder nao sobrescreve o que ja esta no
 * banco, entao ajustes feitos depois nao sao desfeitos no proximo boot.
 * ADMIN recebe tudo aqui apenas por consistencia - a autorizacao ja o libera
 * incondicionalmente (ver PermissionsGuard).
 *
 * GESTOR administra usuarios, mas a regra de hierarquia (`user-access.policy.ts`)
 * o limita a perfis com menos permissoes que o dele: OPERADOR e USUARIO.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionCode[]> = {
  [RoleName.Admin]: Object.values(PermissionCode),
  [RoleName.Gestor]: [
    PermissionCode.UsersRead,
    PermissionCode.UsersCreate,
    PermissionCode.UsersUpdate,
    PermissionCode.UsersStatus,
    PermissionCode.UsersRole,
    PermissionCode.AuditRead,
    // Financeiro: o GESTOR opera o dominio por completo.
    PermissionCode.FinanceRead,
    PermissionCode.FinanceCreate,
    PermissionCode.FinanceUpdate,
    PermissionCode.FinanceStatus,
    // Documentos: mesmo criterio do financeiro - o GESTOR usa o dominio por
    // completo, e por completo hoje e ler e enviar.
    PermissionCode.DocumentsRead,
    PermissionCode.DocumentsCreate,
  ],
  [RoleName.Operador]: [],
  [RoleName.Usuario]: [],
};
