/**
 * Perfis de acesso (RBAC) iniciais do sistema.
 *
 * - ADMIN    acesso total; ignora a checagem de permissoes.
 * - GESTOR   acesso administrativo limitado.
 * - OPERADOR operacoes permitidas (permissoes a definir com os modulos).
 * - USUARIO  acesso basico.
 */
export enum RoleName {
  Admin = 'ADMIN',
  Gestor = 'GESTOR',
  Operador = 'OPERADOR',
  Usuario = 'USUARIO',
}
