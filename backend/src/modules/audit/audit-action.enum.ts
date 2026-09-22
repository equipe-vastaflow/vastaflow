/** Acoes registradas na trilha de auditoria. */
export enum AuditAction {
  Login = 'LOGIN',
  /** Tentativa de login recusada (credenciais invalidas ou usuario inativo). */
  LoginFailed = 'LOGIN_FAILED',
  Logout = 'LOGOUT',
  Register = 'REGISTER',

  // Administracao de usuarios. `usuarioId` e quem executou; o alvo vai em `metadados.alvoId`.
  UserCreated = 'USER_CREATED',
  UserUpdated = 'USER_UPDATED',
  UserActivated = 'USER_ACTIVATED',
  UserDeactivated = 'USER_DEACTIVATED',
  UserRoleChanged = 'USER_ROLE_CHANGED',
}

/** Modulo do sistema onde a acao ocorreu. */
export enum AuditModuleName {
  Auth = 'AUTH',
  Users = 'USERS',
}
