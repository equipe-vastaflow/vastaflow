/** Acoes registradas na trilha de auditoria. */
export enum AuditAction {
  Login = 'LOGIN',
  /** Tentativa de login recusada (credenciais invalidas ou usuario inativo). */
  LoginFailed = 'LOGIN_FAILED',
  Logout = 'LOGOUT',
  Register = 'REGISTER',
}

/** Modulo do sistema onde a acao ocorreu. */
export enum AuditModuleName {
  Auth = 'AUTH',
}
