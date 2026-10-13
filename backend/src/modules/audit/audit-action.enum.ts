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

  /**
   * Documentos. `usuarioId` e quem executou; o documento vai em
   * `metadados.alvoId`.
   *
   * Baixar E auditado, diferente das outras leituras do sistema: o download
   * tira uma copia do conteudo do sistema, e "quem baixou o que" e justamente
   * o que a trilha deve responder - mesmo critério de
   * `FINANCE_REPORT_EXPORTED`.
   *
   * Os metadados levam so identificacao e tamanho. Conteudo, bytes, base64 e a
   * chave fisica do storage NUNCA entram.
   */
  DocumentCreated = 'DOCUMENT_CREATED',
  DocumentDownloaded = 'DOCUMENT_DOWNLOADED',

  /**
   * Consulta a API externa do Plantae por um ADMIN. `usuarioId` e quem
   * consultou. Consulta de dados da cliente e auditada porque sai do Plantae e
   * passa pelo VastaFlow, e "quem consultou o que, e quando" e a pergunta que a
   * trilha deve responder.
   *
   * Os metadados levam so: `endpoint`, `resultado` (`ok`/`erro`), `paginas`,
   * `quantidade`, o PERIODO (`de`/`ate`, quando houver) e, na falha, o `codigo`
   * interno. NUNCA entram filtros de pessoa (`busca`, ids de pessoa), o
   * conteudo devolvido, valores financeiros, CPF/CNPJ nem o token.
   */
  PlantaeQueried = 'PLANTAE_QUERIED',

  /**
   * Mensagem de um canal de mensageria (Telegram) entregue ao backend pela entrada
   * de servico. Uma linha por mensagem. `usuarioId` e a PESSOA vinculada ao
   * remetente (ausente quando nao ha vinculo ou a entrega foi recusada).
   *
   * Os metadados levam so: `canal`, `resultado`, `comando` (apenas nome de comando
   * REGISTRADO), `autorizacao`, `principal` e `credencial` (QUEM entregou, o
   * servico - nunca confundido com a pessoa), `correlacao` e `updateId`. NUNCA o
   * texto da mensagem, a resposta, dado de negocio, token nem o payload do Telegram.
   *
   * `resultado`: EXECUTED, DENIED, UNLINKED, UNKNOWN_COMMAND, FAILED, DUPLICATE,
   * ENVELOPE_REJECTED.
   */
  ChannelMessage = 'CHANNEL_MESSAGE',

  /**
   * Intervencao MANUAL do operador na tabela de eventos do Telegram (CLI
   * `telegram-events`): abandonar um evento preso ou apagar eventos antigos. Sem
   * `usuarioId` (o operador usa o servidor, nao a aplicacao). Os metadados levam so:
   * `operacao` (`abandonar`/`limpar`), `eventoId` ou `quantidade`/`dias`. NUNCA conteudo.
   */
  TelegramEventAdmin = 'TELEGRAM_EVENT_ADMIN',
}

/** Modulo do sistema onde a acao ocorreu. */
export enum AuditModuleName {
  Auth = 'AUTH',
  Users = 'USERS',
  Finance = 'FINANCE',
  Settings = 'SETTINGS',
  Documents = 'DOCUMENTS',
  Plantae = 'PLANTAE',
  Channels = 'CHANNELS',
}
