const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export type RoleName = 'ADMIN' | 'GESTOR' | 'OPERADOR' | 'USUARIO';

export interface User {
  id: string;
  nome: string;
  email: string;
  role: RoleName;
  permissions: string[];
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Validade do token, em segundos. */
  expiresIn: number;
  user: User;
}

export interface UserPage {
  items: User[];
  /** Total de usuarios, em todas as paginas. */
  total: number;
  page: number;
  limit: number;
}

export interface CreateUserInput {
  nome: string;
  email: string;
  senha: string;
  role: RoleName;
}

export interface UpdateUserInput {
  nome?: string;
  email?: string;
}

export interface UserCounts {
  total: number;
  ativos: number;
  inativos: number;
}

/** Evento de auditoria reduzido ao que o dashboard mostra (sem IP nem metadados). */
export interface DashboardAuditEvent {
  id: string;
  acao: string;
  modulo: string;
  descricao: string;
  /** Nulo quando o evento nao tem usuario identificado. */
  usuario: { id: string; nome: string } | null;
  createdAt: string;
}

/**
 * Cada secao vem apenas para quem tem a permissao correspondente
 * (`usuarios` exige `users:read`; `auditoria` exige `audit:read`), entao as
 * duas sao opcionais. Financeiro, automacoes e integracoes entrarao como novas
 * secoes quando esses modulos existirem no backend.
 */
export interface DashboardSummary {
  usuarios?: UserCounts;
  auditoria?: { total: number; recentes: DashboardAuditEvent[] };
}

/**
 * Evento de auditoria como a tela de auditoria o usa.
 *
 * `GET /audit-logs` ainda devolve `ip` e `metadados`, que **nao** sao exibidos
 * e por isso nao entram neste tipo: assim nenhuma tela os mostra por descuido.
 */
export interface AuditLogEntry {
  id: string;
  /** Id do responsavel. Nulo quando o evento nao tem usuario identificado. */
  usuarioId: string | null;
  /**
   * Responsavel identificado. Nulo quando o evento nao tem usuario ou quando
   * o usuario nao existe mais - nesse caso `usuarioId` continua preenchido.
   */
  usuario: { id: string; nome: string; email: string } | null;
  acao: string;
  modulo: string;
  descricao: string;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  /** Total de eventos, em todas as paginas. Vem do backend. */
  total: number;
  page: number;
  limit: number;
}

/**
 * Natureza do lancamento. O `valor` e sempre positivo: e o `tipo` que diz se o
 * dinheiro entra ou sai.
 */
export type FinancialEntryType = 'RECEITA' | 'DESPESA';

/**
 * Situacao do lancamento. Todo lancamento nasce `PENDENTE`; `CANCELADO` e
 * terminal. As transicoes permitidas ficam em `pages/finance/entry-capabilities.ts`.
 */
export type FinancialEntryStatus = 'PENDENTE' | 'PAGO' | 'CANCELADO';

export interface FinancialEntry {
  id: string;
  tipo: FinancialEntryType;
  descricao: string;
  /**
   * Sempre positivo. O backend normaliza a coluna DECIMAL para `number` antes
   * de responder (ver `money.transformer.ts`), entao aqui nunca chega string.
   * O frontend apenas formata - nao faz conta com este valor.
   */
  valor: number;
  /** Dia do evento financeiro, `YYYY-MM-DD`, sem hora e sem fuso. */
  data: string;
  categoria: string;
  status: FinancialEntryStatus;
  observacao: string | null;
  /** Id de quem criou o lancamento. */
  criadoPorId: string;
  /**
   * Autor ja identificado pelo backend, em uma unica consulta em lote. Nulo
   * quando o usuario nao existe mais - `criadoPorId` continua preenchido.
   */
  criadoPor: { id: string; nome: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialEntryPage {
  items: FinancialEntry[];
  /** Total de lancamentos, em todas as paginas. Vem do backend. */
  total: number;
  page: number;
  limit: number;
}

/**
 * `status` e `criadoPorId` NAO entram: o lancamento nasce PENDENTE e o autor e
 * o usuario autenticado. O backend recusa os dois com 400.
 */
export interface CreateFinancialEntryInput {
  tipo: FinancialEntryType;
  descricao: string;
  valor: number;
  data: string;
  categoria: string;
  observacao?: string;
}

/** Edicao parcial. O status muda pela rota propria, nunca por aqui. */
export type UpdateFinancialEntryInput = Partial<CreateFinancialEntryInput>;

/**
 * Canal cuja identidade externa pode ser vinculada a um usuario.
 *
 * So `telegram` - e o unico canal que o backend conhece
 * (`IdentityChannel`). Canal novo entra aqui junto com o adaptador dele.
 */
export type IdentityChannel = 'telegram';

/**
 * Situacao de uma solicitacao de vinculo, como o backend a define.
 *
 * `PENDENTE` aguarda a conta externa enviar o codigo; as outras tres sao
 * terminais. A listagem de pendentes devolve apenas `PENDENTE`.
 */
export type LinkRequestStatus = 'PENDENTE' | 'CONFIRMADA' | 'CANCELADA' | 'EXPIRADA';

/**
 * Vinculo ATIVO entre um usuario e uma conta externa.
 *
 * `idExterno` e o identificador da conta no canal (no Telegram, o id numerico
 * do chat). Nao ha nome nem username: o backend nao os fornece.
 */
export interface ExternalIdentity {
  id: string;
  canal: IdentityChannel;
  idExterno: string;
  createdAt: string;
}

/** Solicitacao de vinculo pendente. Nunca traz o codigo. */
export interface IdentityLinkRequest {
  id: string;
  canal: IdentityChannel;
  status: LinkRequestStatus;
  /** Instante em que o codigo deixa de valer. */
  expiraEm: string;
  createdAt: string;
}

/**
 * Solicitacao recem-criada: a UNICA resposta que traz o codigo.
 *
 * O backend nao o guarda em texto e nao o devolve de novo - nem em listagem,
 * nem em log, nem na auditoria. Quem recebe mostra uma vez e descarta.
 */
export interface CreatedIdentityLinkRequest extends IdentityLinkRequest {
  codigo: string;
  instrucao: string;
}

/** Tipo declarado de uma configuracao do sistema. */
export type SystemSettingType = 'STRING' | 'NUMBER' | 'BOOLEAN';

/** Valor de uma configuracao, ja tipado pelo backend conforme o `tipo`. */
export type SettingValue = string | number | boolean;

/**
 * Configuracao interna do sistema.
 *
 * NAO guarda segredo: nao ha token, senha nem credencial nesta tabela, e por
 * isso nao ha campo mascarado na tela. Chave, tipo e descricao vem de um
 * catalogo no backend e nao sao editaveis - so o `valor` muda.
 */
export interface SystemSetting {
  chave: string;
  valor: SettingValue;
  descricao: string;
  tipo: SystemSettingType;
  /** Id de quem alterou por ultimo. Nulo enquanto o valor for o padrao inicial. */
  atualizadoPorId: string | null;
  /**
   * Responsavel ja identificado pelo backend, em uma unica consulta em lote.
   * Nulo quando ninguem alterou ainda ou quando o usuario nao existe mais.
   */
  atualizadoPor: { id: string; nome: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Perfil do proprio usuario.
 *
 * Contrato separado de `User` (`/auth/me`): ali o que importa e o material de
 * autorizacao, inclusive `permissions`; aqui sao os dados pessoais. `role` e
 * `ativo` vem apenas para LEITURA - a tela os mostra e nao oferece edicao.
 */
export interface Profile {
  id: string;
  nome: string;
  email: string;
  role: RoleName;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Edicao do proprio perfil. Hoje so o nome.
 *
 * `id`, `email`, `role`, `ativo`, permissoes e senha NAO entram: o backend
 * recusa cada um deles com 400, por estarem fora do DTO.
 */
export interface UpdateProfileInput {
  nome?: string;
}

/** Natureza da notificacao. O texto da tela sempre diz qual e - a cor nao e a unica pista. */
export type NotificationType = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

/**
 * Aviso interno destinado ao usuario autenticado.
 *
 * Nao ha `usuarioId`: toda notificacao que a API devolve pertence, por
 * construcao, a quem pediu. O destinatario nunca trafega do cliente para o
 * servidor - ele vem do JWT.
 */
export interface AppNotification {
  id: string;
  titulo: string;
  mensagem: string;
  tipo: NotificationType;
  lida: boolean;
  createdAt: string;
  /** Quando foi marcada como lida, se ja foi. */
  updatedAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  /** Total de notificacoes do usuario, em todas as paginas. Vem do backend. */
  total: number;
  page: number;
  limit: number;
  /** Quantas paginas existem com este `limit`. Calculado pelo backend. */
  totalPages: number;
}

export interface UnreadCount {
  count: number;
}

/** Quantas notificacoes passaram de nao lida para lida. */
export interface ReadAllResult {
  atualizadas: number;
}

/** Erro devolvido pela API (status HTTP diferente de 2xx). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Nao foi possivel falar com o servidor (offline, CORS, servidor fora do ar). */
export class NetworkError extends Error {
  constructor() {
    super('Nao foi possivel conectar ao servidor');
    this.name = 'NetworkError';
  }
}

async function request<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new NetworkError();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  // 204 No Content (logout, remocao de vinculo) nao tem corpo.
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** O backend responde `{ message: string | string[] }`. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? response.statusText);
  } catch {
    return response.statusText;
  }
}

const userPath = (id: string): string => `/users/${encodeURIComponent(id)}`;
const externalIdentitiesPath = (userId: string): string =>
  `${userPath(userId)}/external-identities`;
const entryPath = (id: string): string => `/finance/entries/${encodeURIComponent(id)}`;
const settingPath = (chave: string): string => `/settings/${encodeURIComponent(chave)}`;
const notificationPath = (id: string): string => `/notifications/${encodeURIComponent(id)}`;

export const api = {
  login: (email: string, senha: string): Promise<LoginResponse> =>
    request('/auth/login', { method: 'POST', body: { email, senha } }),

  me: (token: string): Promise<User> => request('/auth/me', { token }),

  logout: (token: string): Promise<void> => request('/auth/logout', { method: 'POST', token }),

  dashboard: {
    summary: (token: string): Promise<DashboardSummary> => request('/dashboard/summary', { token }),
  },

  auditLogs: {
    list: (token: string, page: number, limit: number): Promise<AuditLogPage> =>
      request(
        `/audit-logs?${new URLSearchParams({ page: String(page), limit: String(limit) }).toString()}`,
        { token },
      ),
  },

  users: {
    list: (token: string, page: number, limit: number): Promise<UserPage> =>
      request(`/users?${new URLSearchParams({ page: String(page), limit: String(limit) }).toString()}`, {
        token,
      }),

    get: (token: string, id: string): Promise<User> => request(userPath(id), { token }),

    /** Perfis que o usuario autenticado pode conceder (e, portanto, gerenciar). */
    assignableRoles: (token: string): Promise<RoleName[]> =>
      request('/users/assignable-roles', { token }),

    create: (token: string, input: CreateUserInput): Promise<User> =>
      request('/users', { method: 'POST', body: input, token }),

    update: (token: string, id: string, input: UpdateUserInput): Promise<User> =>
      request(userPath(id), { method: 'PATCH', body: input, token }),

    setStatus: (token: string, id: string, ativo: boolean): Promise<User> =>
      request(`${userPath(id)}/status`, { method: 'PATCH', body: { ativo }, token }),

    setRole: (token: string, id: string, role: RoleName): Promise<User> =>
      request(`${userPath(id)}/role`, { method: 'PATCH', body: { role }, token }),
  },

  /**
   * Vinculos de identidade externa de um usuario.
   *
   * Consultar exige `users:read`; iniciar, cancelar e desvincular exigem
   * `users:update` com a hierarquia da edicao de usuarios - as mesmas
   * permissoes que o backend aplica, sem nenhuma nova.
   */
  externalIdentities: {
    list: (token: string, userId: string): Promise<ExternalIdentity[]> =>
      request(externalIdentitiesPath(userId), { token }),

    listLinkRequests: (token: string, userId: string): Promise<IdentityLinkRequest[]> =>
      request(`${externalIdentitiesPath(userId)}/link-requests`, { token }),

    /**
     * Inicia a vinculacao. O corpo leva SOMENTE o canal: nao existe campo de id
     * externo - quem prova a posse e a propria conta, enviando o codigo ao bot.
     */
    createLinkRequest: (
      token: string,
      userId: string,
      canal: IdentityChannel,
    ): Promise<CreatedIdentityLinkRequest> =>
      request(`${externalIdentitiesPath(userId)}/link-requests`, {
        method: 'POST',
        body: { canal },
        token,
      }),

    cancelLinkRequest: (token: string, userId: string, requestId: string): Promise<void> =>
      request(`${externalIdentitiesPath(userId)}/link-requests/${encodeURIComponent(requestId)}`, {
        method: 'DELETE',
        token,
      }),

    remove: (token: string, userId: string, linkId: string): Promise<void> =>
      request(`${externalIdentitiesPath(userId)}/${encodeURIComponent(linkId)}`, {
        method: 'DELETE',
        token,
      }),
  },

  profile: {
    get: (token: string): Promise<Profile> => request('/profile', { token }),

    update: (token: string, input: UpdateProfileInput): Promise<Profile> =>
      request('/profile', { method: 'PATCH', body: input, token }),
  },

  notifications: {
    list: (token: string, page: number, limit: number): Promise<NotificationPage> =>
      request(
        `/notifications?${new URLSearchParams({ page: String(page), limit: String(limit) }).toString()}`,
        { token },
      ),

    /** Uma consulta COUNT no backend. Alimenta o contador do menu. */
    unreadCount: (token: string): Promise<UnreadCount> =>
      request('/notifications/unread-count', { token }),

    /** Idempotente: marcar de novo continua respondendo 200. */
    markAsRead: (token: string, id: string): Promise<AppNotification> =>
      request(`${notificationPath(id)}/read`, { method: 'PATCH', token }),

    /** Idempotente: sem nenhuma por ler, devolve `atualizadas: 0`. */
    markAllAsRead: (token: string): Promise<ReadAllResult> =>
      request('/notifications/read-all', { method: 'PATCH', token }),
  },

  settings: {
    /** Sem paginacao: o catalogo e um conjunto fechado, definido no backend. */
    list: (token: string): Promise<SystemSetting[]> => request('/settings', { token }),

    get: (token: string, chave: string): Promise<SystemSetting> =>
      request(settingPath(chave), { token }),

    /**
     * Altera SOMENTE o valor. O tipo precisa corresponder ao `tipo` da
     * configuracao - o backend recusa `"true"` numa chave BOOLEAN, por exemplo.
     */
    update: (token: string, chave: string, valor: SettingValue): Promise<SystemSetting> =>
      request(settingPath(chave), { method: 'PATCH', body: { valor }, token }),
  },

  finance: {
    list: (token: string, page: number, limit: number): Promise<FinancialEntryPage> =>
      request(
        `/finance/entries?${new URLSearchParams({ page: String(page), limit: String(limit) }).toString()}`,
        { token },
      ),

    get: (token: string, id: string): Promise<FinancialEntry> => request(entryPath(id), { token }),

    create: (token: string, input: CreateFinancialEntryInput): Promise<FinancialEntry> =>
      request('/finance/entries', { method: 'POST', body: input, token }),

    update: (
      token: string,
      id: string,
      input: UpdateFinancialEntryInput,
    ): Promise<FinancialEntry> => request(entryPath(id), { method: 'PATCH', body: input, token }),

    /** Transicoes validas: PENDENTE -> PAGO | CANCELADO e PAGO -> CANCELADO. */
    setStatus: (token: string, id: string, status: FinancialEntryStatus): Promise<FinancialEntry> =>
      request(`${entryPath(id)}/status`, { method: 'PATCH', body: { status }, token }),
  },
};
