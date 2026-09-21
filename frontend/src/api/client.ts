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
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Validade do token, em segundos. */
  expiresIn: number;
  user: User;
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
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
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

export const api = {
  login: (email: string, senha: string): Promise<LoginResponse> =>
    request('/auth/login', { method: 'POST', body: { email, senha } }),

  me: (token: string): Promise<User> => request('/auth/me', { token }),

  logout: (token: string): Promise<void> => request('/auth/logout', { method: 'POST', token }),
};
