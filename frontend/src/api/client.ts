import { resolveApiUrl } from './api-url';

/**
 * URL base da API. Ver `api-url.ts`: em producao `VITE_API_URL` e obrigatoria,
 * e o build falha antes de chegar aqui (plugin em `vite.config.ts`). Esta
 * chamada e a segunda barreira, para um build feito por outro caminho.
 */
const API_URL = resolveApiUrl(import.meta.env);

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
 * Recorte de lancamentos. Os MESMOS filtros servem a listagem e aos relatorios.
 *
 * O periodo compara a data do lancamento (`data`), inclusiva nas duas pontas.
 * Nao existe data de pagamento no modelo, portanto nao ha como filtrar por
 * "quando foi pago".
 *
 * Campo ausente significa "sem esse filtro". String vazia NAO e enviada: o
 * backend recusaria uma data vazia com 400.
 */
export interface FinanceFilter {
  /** `YYYY-MM-DD`. */
  de?: string;
  /** `YYYY-MM-DD`. */
  ate?: string;
  status?: FinancialEntryStatus;
  tipo?: FinancialEntryType;
  categoria?: string;
}

/** Recorte de relatorio: aqui o periodo e obrigatorio. */
export interface FinanceReportFilter extends FinanceFilter {
  de: string;
  ate: string;
}

/** Uma linha de agrupamento do resumo. `valor` e sempre positivo. */
export interface FinanceGroupTotal {
  quantidade: number;
  valor: number;
}

export interface FinanceStatusTotal extends FinanceGroupTotal {
  status: FinancialEntryStatus;
}

export interface FinanceTypeTotal extends FinanceGroupTotal {
  tipo: FinancialEntryType;
}

export interface FinanceCategoryTotal extends FinanceGroupTotal {
  categoria: string;
}

/**
 * Resumo financeiro do recorte, calculado INTEIRAMENTE no backend.
 *
 * A tela nao soma nada: paginar e somar no cliente daria um total so da pagina
 * visivel. Nao existe um `valorTotal` generico de proposito - somar receita com
 * despesa nao significa nada, porque o sinal esta no `tipo`. Quem representa
 * dinheiro liquido e o `saldo`.
 */
export interface FinanceReportSummary {
  /** O recorte aplicado, como o backend o entendeu. Ausente vem como `null`. */
  filtros: {
    de: string;
    ate: string;
    status: FinancialEntryStatus | null;
    tipo: FinancialEntryType | null;
    categoria: string | null;
  };
  /** Inclui os CANCELADOS. */
  totalRegistros: number;
  /** Soma das RECEITAS, sem os CANCELADOS. */
  totalReceitas: number;
  /** Soma das DESPESAS, sem os CANCELADOS. */
  totalDespesas: number;
  /** Receitas menos despesas, sem os CANCELADOS. Pode ser negativo. */
  saldo: number;
  /** Inclui a linha de CANCELADO, que fica fora do saldo. */
  porStatus: FinanceStatusTotal[];
  porTipo: FinanceTypeTotal[];
  porCategoria: FinanceCategoryTotal[];
}

/** Planilha baixada, com o nome que o backend definiu. */
export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/**
 * Documento armazenado pelo sistema.
 *
 * NAO existe campo de chave de storage, caminho fisico, bucket nem regiao: o
 * backend nao os expoe, porque sao infraestrutura. O download recebe o `id`.
 */
export interface DocumentFile {
  id: string;
  /** Nome logico exibido. */
  nome: string;
  /** Nome como foi enviado, preservado como metadado. */
  nomeOriginal: string;
  mimeType: string;
  /** Tamanho em bytes. O backend normaliza para `number` antes de responder. */
  tamanho: number;
  /** Quem enviou. Metadado de auditoria, NAO controle de acesso. */
  criadoPorId: string;
  /** Autor ja identificado pelo backend. Nulo quando o usuario nao existe mais. */
  criadoPor: { id: string; nome: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentPage {
  items: DocumentFile[];
  /** Total de documentos, em todas as paginas. Vem do backend. */
  total: number;
  page: number;
  limit: number;
}

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

/**
 * Baixa uma resposta binaria (hoje so a planilha do financeiro).
 *
 * Separado de `request` porque aquele sempre interpreta o corpo como JSON. Erro
 * continua vindo em JSON mesmo nesta rota - o backend confere periodo e volume
 * ANTES de escrever qualquer byte -, portanto a leitura da mensagem e a mesma.
 */
async function requestBlob(
  path: string,
  options: { token?: string; fallbackFilename: string },
): Promise<DownloadedFile> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { method: 'GET', headers });
  } catch {
    throw new NetworkError();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  return {
    blob: await response.blob(),
    // O backend e a fonte do nome. Entre origens diferentes o navegador so
    // entrega este cabecalho porque a API o declara em `exposedHeaders`; se por
    // algum motivo nao vier, o nome local evita um download sem nome util.
    filename:
      filenameFromDisposition(response.headers.get('Content-Disposition')) ??
      options.fallbackFilename,
  };
}

/**
 * Envia `FormData` (hoje so o upload de documento).
 *
 * Terceira funcao de HTTP, e nao um parametro novo em `request`: aquela fixa
 * `Content-Type: application/json` e serializa o corpo com `JSON.stringify`, o
 * que transformaria um `FormData` em `"{}"`. Sao incompativeis por construcao.
 *
 * O `Content-Type` NAO e definido aqui de proposito: quem monta o cabecalho com
 * o `boundary` correto e o proprio navegador, a partir do `FormData`. Definir a
 * mao quebraria o parser do servidor.
 */
async function requestMultipart<T>(
  path: string,
  options: { body: FormData; token?: string },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers,
      body: options.body,
    });
  } catch {
    throw new NetworkError();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  return (await response.json()) as T;
}

/** Le `attachment; filename="..."`. Devolve `null` quando nao da para extrair. */
function filenameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  return match ? match[1] : null;
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

/**
 * Monta a query string do recorte, omitindo o que nao foi informado.
 *
 * Omitir e diferente de enviar vazio: `de=` levaria um 400, porque o backend
 * valida o formato da data. Por isso campo vazio nem entra na URL.
 */
function financeFilterParams(filter: FinanceFilter): URLSearchParams {
  // Campo por campo, e nao `Object.entries`: aquele perde o tipo do valor e
  // deixaria passar um campo novo do recorte sem ninguem notar.
  const campos: [string, string | undefined][] = [
    ['de', filter.de],
    ['ate', filter.ate],
    ['status', filter.status],
    ['tipo', filter.tipo],
    ['categoria', filter.categoria],
  ];

  const params = new URLSearchParams();
  for (const [chave, valor] of campos) {
    if (valor !== undefined && valor !== '') {
      params.set(chave, valor);
    }
  }
  return params;
}
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

  /**
   * Documentos. Ler exige `documents:read`; enviar, `documents:create`.
   *
   * Nao ha renomear, excluir nem versionar: essas operacoes nao existem no
   * backend desta fase.
   */
  documents: {
    list: (token: string, page: number, limit: number): Promise<DocumentPage> =>
      request(
        `/documents?${new URLSearchParams({ page: String(page), limit: String(limit) }).toString()}`,
        { token },
      ),

    /**
     * Envia um arquivo. O campo do multipart e `arquivo`, como o backend espera.
     *
     * O nome vai junto no `FormData`; o servidor o guarda como metadado e gera
     * a propria chave fisica.
     */
    upload: (token: string, file: File): Promise<DocumentFile> => {
      const body = new FormData();
      body.append('arquivo', file);
      return requestMultipart('/documents', { body, token });
    },

    /**
     * Baixa o conteudo. Reusa o mesmo caminho binario da exportacao do
     * financeiro - nada de base64.
     */
    download: (token: string, document: DocumentFile): Promise<DownloadedFile> =>
      requestBlob(`/documents/${encodeURIComponent(document.id)}/download`, {
        token,
        fallbackFilename: document.nomeOriginal,
      }),
  },

  finance: {
    /**
     * Pagina de lancamentos, com o recorte aplicado no banco.
     *
     * `total` passa a ser o total do conjunto FILTRADO: e o que mantem a
     * paginacao coerente com o que foi pedido.
     */
    list: (
      token: string,
      page: number,
      limit: number,
      filter: FinanceFilter = {},
    ): Promise<FinancialEntryPage> => {
      const params = financeFilterParams(filter);
      params.set('page', String(page));
      params.set('limit', String(limit));
      return request(`/finance/entries?${params.toString()}`, { token });
    },

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

    /**
     * Relatorios. Exigem `finance:read`, a mesma permissao da listagem - nao ha
     * permissao propria de exportacao.
     */
    reports: {
      summary: (token: string, filter: FinanceReportFilter): Promise<FinanceReportSummary> =>
        request(`/finance/reports/summary?${financeFilterParams(filter).toString()}`, { token }),

      /**
       * Baixa a planilha dos lancamentos do recorte.
       *
       * Responde 409 quando o recorte passa do limite de linhas; a mensagem do
       * backend ja orienta a reduzir o periodo.
       */
      export: (token: string, filter: FinanceReportFilter): Promise<DownloadedFile> =>
        requestBlob(`/finance/reports/export?${financeFilterParams(filter).toString()}`, {
          token,
          fallbackFilename: `vastaflow-financeiro-${filter.de}-a-${filter.ate}.xlsx`,
        }),
    },
  },
};
