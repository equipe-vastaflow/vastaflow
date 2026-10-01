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
  /**
   * Vinculacao de identidade externa (ex.: conta do Telegram). O codigo de
   * confirmacao NUNCA entra nos metadados.
   *
   * - `IDENTITY_LINK_REQUESTED` / `IDENTITY_LINK_CANCELLED`: `alvoId`, `solicitacaoId`
   *   (e `canal`, `expiraEm` na criacao);
   * - `EXTERNAL_IDENTITY_LINKED`: confirmada pela propria conta externa;
   *   `usuarioId` e o usuario vinculado. `alvoId`, `solicitacaoId`, `vinculoId`,
   *   `canal`, `idExterno`;
   * - `EXTERNAL_IDENTITY_UNLINKED`: `alvoId`, `vinculoId`, `canal`, `idExterno`.
   */
  ExternalIdentityLinkRequested = 'IDENTITY_LINK_REQUESTED',
  ExternalIdentityLinkRequestCancelled = 'IDENTITY_LINK_CANCELLED',
  ExternalIdentityLinked = 'EXTERNAL_IDENTITY_LINKED',
  ExternalIdentityUnlinked = 'EXTERNAL_IDENTITY_UNLINKED',

  // Financeiro. `usuarioId` e quem executou; o lancamento vai em `metadados.alvoId`.
  FinanceEntryCreated = 'FINANCE_ENTRY_CREATED',
  FinanceEntryUpdated = 'FINANCE_ENTRY_UPDATED',
  FinanceEntryStatusChanged = 'FINANCE_ENTRY_STATUS_CHANGED',
  /**
   * Exportacao de relatorio financeiro em planilha. Consultar relatorio NAO e
   * auditado; exportar e, porque gera um arquivo que sai do sistema. Os
   * metadados levam so o recorte (`de`, `ate`, `status`, `tipo`, `categoria`) e
   * a `quantidade` de linhas - nenhum valor monetario, nenhuma descricao.
   */
  FinanceReportExported = 'FINANCE_REPORT_EXPORTED',

  /** Configuracoes do sistema. A chave alterada vai em `metadados.chave`; o valor nunca entra. */
  SystemSettingUpdated = 'SYSTEM_SETTING_UPDATED',
}

/** Modulo do sistema onde a acao ocorreu. */
export enum AuditModuleName {
  Auth = 'AUTH',
  Users = 'USERS',
  Finance = 'FINANCE',
  Settings = 'SETTINGS',
}
