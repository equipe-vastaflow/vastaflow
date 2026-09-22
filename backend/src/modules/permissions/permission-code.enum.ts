/**
 * Catalogo de permissoes granulares do sistema.
 *
 * Formato `<recurso>:<acao>`. Cada modulo novo acrescenta aqui as suas
 * permissoes e o seeder as cria no banco no proximo boot - nenhuma mudanca de
 * schema e necessaria.
 *
 * Hoje ha apenas as permissoes exercitadas pelo modulo de usuarios e auditoria;
 * as demais serao definidas junto com os modulos que as usam.
 */
export enum PermissionCode {
  UsersRead = 'users:read',
  UsersCreate = 'users:create',
  UsersUpdate = 'users:update',
  UsersStatus = 'users:status',
  UsersRole = 'users:role',
  AuditRead = 'audit:read',
}

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  [PermissionCode.UsersRead]: 'Listar e consultar usuarios',
  [PermissionCode.UsersCreate]: 'Criar usuarios',
  [PermissionCode.UsersUpdate]: 'Editar nome e e-mail de usuarios',
  [PermissionCode.UsersStatus]: 'Ativar e desativar usuarios',
  [PermissionCode.UsersRole]: 'Alterar o perfil de usuarios',
  [PermissionCode.AuditRead]: 'Consultar o log de auditoria',
};
