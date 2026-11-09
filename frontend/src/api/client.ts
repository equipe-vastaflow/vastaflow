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

/**
 * Troca da PROPRIA senha (`POST /auth/change-password`). So estes dois campos: nao ha id nem e-mail, o
 * alvo e quem esta autenticado. A resposta traz um token NOVO (o antigo deixa de valer).
 */
export interface ChangePasswordInput {
  senhaAtual: string;
  novaSenha: string;
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

// --- Plantae (somente leitura) ----------------------------------------------
// Espelham `backend/src/modules/integrations/plantae/plantae.types.ts`. Valores
// monetarios chegam como TEXTO decimal exato (`"8337.10"`), nunca `number`: o
// frontend so formata, sem converter nem somar. CPF/CNPJ ja chega MASCARADO.

/** Texto decimal exato vindo do Plantae (`-?digitos(.digitos)?`). */
export type PlantaeDecimal = string;

/** Valor codificado da API: `{ codigo, descricao }`. */
export interface PlantaeCodedValue<C extends string | number> {
  codigo: C;
  descricao: string | null;
}

export interface PlantaePerson {
  pessoa_id: number;
  nome: string | null;
  razao_social: string | null;
  tipo_pessoa: string | null;
  /** Mascarado pelo backend (`***.456.789-**`, `12.345.678/****-**`). */
  cpf_cnpj: string | null;
}

export interface PlantaeCurrency {
  moeda_id: number;
  nome: string | null;
  simbolo: string | null;
}

export interface PlantaeEntryTitle {
  titulo_id: number;
  tipo: PlantaeCodedValue<number> | null;
  origem: PlantaeCodedValue<number> | null;
  num_documento: string | null;
  data_emissao: string | null;
  valor_total: PlantaeDecimal | null;
  moeda: PlantaeCurrency | null;
  descricao: string | null;
  observacao: string | null;
}

/**
 * Uma PARCELA de titulo a pagar/receber. Nao traz se e receita ou despesa: isso
 * e o filtro `tipo` da consulta. `status.codigo`: 0 pendente, 1 quitada,
 * 2 substituida (renegociada; NAO e cancelada).
 *
 * `rateio` e `razao_social` existem no contrato mas nao sao usados pela tela.
 */
export interface PlantaeEntry {
  parcela_id: number;
  numero: number | null;
  total_parcelas: number | null;
  data_vencto: string | null;
  valor: PlantaeDecimal | null;
  total_pago: PlantaeDecimal | null;
  total_juros: PlantaeDecimal | null;
  total_multa: PlantaeDecimal | null;
  total_desconto: PlantaeDecimal | null;
  total_abatido: PlantaeDecimal | null;
  saldo_atual: PlantaeDecimal | null;
  data_ult_pagto: string | null;
  status: PlantaeCodedValue<number>;
  titulo: PlantaeEntryTitle;
  pessoa: PlantaePerson | null;
}

/** O que o backend sabe sobre o resto da listagem. */
export interface PlantaePagination {
  perPage: number | null;
  /** Cursor OPACO: devolvido como veio, nunca montado nem alterado. */
  nextCursor: string | null;
  /** `null` = o Plantae nao informou (nunca se afirma que acabou). */
  hasMore: boolean | null;
  pagesFetched: number;
}

export interface PlantaeList<T> {
  data: T[];
  pagination: PlantaePagination;
}

export type PlantaeEntryKind = 'receita' | 'despesa';
export type PlantaeEntryStatusCode = 0 | 1 | 2;

/** Consulta de parcelas. Periodo `AAAA-MM-DD`, extremos incluidos. */
export interface PlantaeEntriesQuery {
  dataInicio: string;
  dataFim: string;
  tipo: PlantaeEntryKind;
  status?: PlantaeEntryStatusCode;
  cursor?: string;
}

/** `1` caixa, `2` bancaria, `3` aplicacao, `4` numerario em transito. */
export type PlantaeAccountType = 1 | 2 | 3 | 4;

/** Conta de caixa, bancaria, aplicacao ou numerario em transito. Nao traz saldo. */
export interface PlantaeAccount {
  conta_id: number;
  nome: string | null;
  tipo: PlantaeCodedValue<number>;
  banco: { banco_id: number; nome: string | null } | null;
  agencia: string | null;
  /** Mascarado pelo backend: `****` + os ultimos 4 caracteres. */
  numero_conta: string | null;
  conta_bancaria_id: number | null;
}

/**
 * Movimentacao (entrada ou saida de uma conta); tambem e a linha do extrato.
 * Valores sem moeda no contrato (a documentacao da API diz "em reais").
 */
export interface PlantaeMovement {
  mov_conta_id: number;
  cheque_id: number | null;
  data: string | null;
  /** `C` credito (entrada) ou `D` debito (saida). */
  natureza: PlantaeCodedValue<'C' | 'D'>;
  valor: PlantaeDecimal;
  conta: { conta_id: number; nome: string | null; tipo: PlantaeCodedValue<number> | null };
  origem: PlantaeCodedValue<number> | null;
  descricao: string | null;
  forma_pagamento: PlantaeCodedValue<number> | null;
  numero_cheque: string | null;
  pessoa: PlantaePerson | null;
  titulo_id: number | null;
  parcela_id: number | null;
  conta_contrapartida: { conta_id: number; nome: string | null } | null;
  conciliado: boolean;
  data_conciliacao: string | null;
  /** Saldo da conta DEPOIS da linha: vem no EXTRATO; na listagem de movimentacoes e `null`. */
  saldo: PlantaeDecimal | null;
}

/** Extrato: `saldos` sao do PERIODO inteiro, iguais em todas as paginas. */
export interface PlantaeStatement extends PlantaeList<PlantaeMovement> {
  saldos: { saldo_anterior: PlantaeDecimal; saldo_final: PlantaeDecimal };
}

export interface PlantaeAccountsQuery {
  tipo?: PlantaeAccountType;
  cursor?: string;
}

export interface PlantaeMovementsQuery {
  dataInicio: string;
  dataFim: string;
  natureza?: 'C' | 'D';
  conciliado?: boolean;
  cursor?: string;
}

export interface PlantaeStatementQuery {
  contaId: number;
  dataInicio: string;
  dataFim: string;
  cursor?: string;
}

export interface PlantaePeopleQuery {
  /** Nome, razao social ou CPF/CNPJ (2 a 100 caracteres). Nunca vai para log nem auditoria. */
  busca?: string;
  cursor?: string;
}

/** Itens por pagina nas consultas do Plantae pelo painel. */
export const PLANTAE_PAGE_SIZE = 50;

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
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    token?: string;
    /** So as consultas do Plantae usam (`no-store`): dado financeiro nao fica em cache. */
    cache?: RequestCache;
  } = {},
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
      ...(options.cache === undefined ? {} : { cache: options.cache }),
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
/**
 * Query de `GET /integrations/plantae/financial/entries`.
 *
 * So parametros que o backend aceita (parametro desconhecido = 400): periodo,
 * `tipo`, um `status`, `per_page` fixo, UMA pagina por chamada e o cursor opaco
 * da resposta anterior, quando houver. Nenhum filtro de pessoa.
 */
export function plantaeEntriesParams(query: PlantaeEntriesQuery): URLSearchParams {
  const params = new URLSearchParams({
    data_inicio: query.dataInicio,
    data_fim: query.dataFim,
    tipo: query.tipo,
    per_page: String(PLANTAE_PAGE_SIZE),
    paginas: '1',
  });
  if (query.status !== undefined) {
    params.set('status', String(query.status));
  }
  if (query.cursor !== undefined) {
    params.set('cursor', query.cursor);
  }
  return params;
}

/** `per_page` fixo, UMA pagina por chamada e, se houver, o cursor opaco anterior. */
function plantaePageParams(cursor: string | undefined): URLSearchParams {
  const params = new URLSearchParams({ per_page: String(PLANTAE_PAGE_SIZE), paginas: '1' });
  if (cursor !== undefined) {
    params.set('cursor', cursor);
  }
  return params;
}

/** Query de `financial/accounts`: um `tipo` opcional. */
export function plantaeAccountsParams(query: PlantaeAccountsQuery): URLSearchParams {
  const params = plantaePageParams(query.cursor);
  if (query.tipo !== undefined) {
    params.set('tipo', String(query.tipo));
  }
  return params;
}

/** Query de `financial/movements`: periodo, `natureza` e `conciliado` opcionais. Sem conta nem origem. */
export function plantaeMovementsParams(query: PlantaeMovementsQuery): URLSearchParams {
  const params = plantaePageParams(query.cursor);
  params.set('data_inicio', query.dataInicio);
  params.set('data_fim', query.dataFim);
  if (query.natureza !== undefined) {
    params.set('natureza', query.natureza);
  }
  if (query.conciliado !== undefined) {
    params.set('conciliado', query.conciliado ? 'true' : 'false');
  }
  return params;
}

/** Query de `financial/account-statement`: UMA conta (id de `financial/accounts`) e o periodo. */
export function plantaeStatementParams(query: PlantaeStatementQuery): URLSearchParams {
  const params = plantaePageParams(query.cursor);
  params.set('data_inicio', query.dataInicio);
  params.set('data_fim', query.dataFim);
  params.set('conta_id', String(query.contaId));
  return params;
}

/** Query de `people`: `busca` so quando informada (aparada; vazio nao vai). */
export function plantaePeopleParams(query: PlantaePeopleQuery): URLSearchParams {
  const params = plantaePageParams(query.cursor);
  const busca = query.busca?.trim();
  if (busca) {
    params.set('busca', busca);
  }
  return params;
}

const settingPath = (chave: string): string => `/settings/${encodeURIComponent(chave)}`;
const notificationPath = (id: string): string => `/notifications/${encodeURIComponent(id)}`;

export const api = {
  login: (email: string, senha: string): Promise<LoginResponse> =>
    request('/auth/login', { method: 'POST', body: { email, senha } }),

  me: (token: string): Promise<User> => request('/auth/me', { token }),

  /** Senha atual incorreta responde 400 (nunca 401): a tela nao confunde com sessao expirada. */
  changePassword: (token: string, input: ChangePasswordInput): Promise<LoginResponse> =>
    request('/auth/change-password', { method: 'POST', body: input, token }),

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

  /**
   * Consultas ao Plantae em tempo real (somente leitura, `plantae:read`).
   * Sempre `cache: 'no-store'`: o backend tambem responde `Cache-Control: no-store`.
   */
  plantae: {
    entries: (token: string, query: PlantaeEntriesQuery): Promise<PlantaeList<PlantaeEntry>> =>
      request(`/integrations/plantae/financial/entries?${plantaeEntriesParams(query).toString()}`, {
        token,
        cache: 'no-store',
      }),

    accounts: (token: string, query: PlantaeAccountsQuery): Promise<PlantaeList<PlantaeAccount>> =>
      request(`/integrations/plantae/financial/accounts?${plantaeAccountsParams(query).toString()}`, {
        token,
        cache: 'no-store',
      }),

    movements: (
      token: string,
      query: PlantaeMovementsQuery,
    ): Promise<PlantaeList<PlantaeMovement>> =>
      request(
        `/integrations/plantae/financial/movements?${plantaeMovementsParams(query).toString()}`,
        { token, cache: 'no-store' },
      ),

    statement: (token: string, query: PlantaeStatementQuery): Promise<PlantaeStatement> =>
      request(
        `/integrations/plantae/financial/account-statement?${plantaeStatementParams(query).toString()}`,
        { token, cache: 'no-store' },
      ),

    people: (token: string, query: PlantaePeopleQuery): Promise<PlantaeList<PlantaePerson>> =>
      request(`/integrations/plantae/people?${plantaePeopleParams(query).toString()}`, {
        token,
        cache: 'no-store',
      }),
  },
};
