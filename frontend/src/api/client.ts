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
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; token?: string } = {},
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

  // 204 No Content (logout) nao tem corpo.
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
};
