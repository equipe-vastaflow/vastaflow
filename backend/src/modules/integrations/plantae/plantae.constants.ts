/** Identificador no `IntegrationRegistry`. */
export const PLANTAE_PROVIDER_ID = 'plantae';

/** Chaves de configuracao. Os VALORES so sao lidos em `plantae-settings.ts` e no cliente HTTP. */
export const PLANTAE_ENABLED_KEY = 'PLANTAE_ENABLED';
export const PLANTAE_BASE_URL_KEY = 'PLANTAE_BASE_URL';
export const PLANTAE_API_TOKEN_KEY = 'PLANTAE_API_TOKEN';
export const PLANTAE_TIMEOUT_MS_KEY = 'PLANTAE_TIMEOUT_MS';

/** Caminho fixo da API externa. Na colecao oficial, `{{baseUrl}}` = host + este caminho. */
export const PLANTAE_API_PATH = '/api/v1/external';

export type PlantaeEnvironment = 'homologation' | 'production';

/**
 * Hosts que o VastaFlow aceita como Plantae, e o ambiente de cada um. LISTA FECHADA: exatamente estes dois, e nenhum
 * outro (nem subdominio, nem prefixo, nem o dominio raiz). Acrescentar um host e uma mudanca de codigo revisada - nunca
 * uma variavel de ambiente que alguem troque por engano e aponte a integracao para o lugar errado.
 *
 * - `rc.plantae.agr.br`: HOMOLOGACAO (dados de teste; copia do ambiente da cliente).
 * - `web.plantae.agr.br`: PRODUCAO (dados REAIS). Endereco enviado oficialmente pelo fornecedor; a classificacao como
 *   producao ainda precisa de CONFIRMACAO ESCRITA do fornecedor (ver docs/integracao-plantae.md, secao 11). Enquanto isso
 *   o codigo trata os dados como reais e nunca os rotula como homologacao.
 */
export const PLANTAE_ENVIRONMENTS: Readonly<Record<string, PlantaeEnvironment>> = {
  'rc.plantae.agr.br': 'homologation',
  'web.plantae.agr.br': 'production',
};

/** Endpoints da colecao oficial. Exatamente estes oito, todos GET. */
export const PlantaeEndpoint = {
  Me: '/me',
  FinancialEntries: '/financial/entries',
  FinancialAccounts: '/financial/accounts',
  FinancialMovements: '/financial/movements',
  FinancialAccountStatement: '/financial/account-statement',
  FiscalIssuedInvoices: '/fiscal/issued-invoices',
  OrganizationLegalEntities: '/organization/legal-entities',
  People: '/people',
} as const;

export type PlantaeEndpointPath = (typeof PlantaeEndpoint)[keyof typeof PlantaeEndpoint];

// --- limites da API documentada ---------------------------------------------

/** "O periodo pode ter ate 366 dias" (colecao oficial), os dois extremos incluidos. */
export const MAX_PERIOD_DAYS = 366;
export const PER_PAGE_MIN = 1;
export const PER_PAGE_MAX = 500;

// --- limites locais (conservadores) -----------------------------------------

/** Timeout de UMA requisicao ao Plantae. */
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 60_000;

/** Paginas que UMA chamada do VastaFlow pode ler. Cada pagina consome 1 das 60 req/min. */
export const DEFAULT_PAGES_PER_CALL = 1;
export const MAX_PAGES_PER_CALL = 5;
/** Teto de itens acumulados numa chamada: controla a memoria. */
export const MAX_ITEMS_PER_CALL = 2_500;
/** Teto do corpo de UMA resposta. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Filtros de lista (`pessoa_id[]` etc.). */
export const MAX_FILTER_IDS = 50;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
/** O cursor e opaco; so limitamos o tamanho. */
export const CURSOR_MAX_LENGTH = 2_048;

/** Sanidade das datas de FILTRO (nao das datas que o Plantae devolve). */
export const MIN_FILTER_YEAR = 1900;
export const MAX_FILTER_YEAR = 2100;

// --- taxa e repeticao -------------------------------------------------------

/** O Plantae permite 60/min por chave. Usamos menos: sobra margem para outro uso da mesma chave. */
export const RATE_LIMIT_MAX_REQUESTS = 50;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const MAX_CONCURRENT_REQUESTS = 2;
/** Quanto uma chamada aceita ESPERAR por uma vaga antes de desistir. */
export const MAX_RATE_WAIT_MS = 20_000;

export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_JITTER_MS = 250;
/**
 * `Retry-After` maior que isto nao e esperado dentro da requisicao: devolve-se
 * 429 ao chamador. Fica abaixo de `MAX_RATE_WAIT_MS`, senao o limitador
 * desistiria antes do fim da espera que acabou de prometer.
 */
export const MAX_AUTOMATIC_RETRY_AFTER_MS = 15_000;
/** Sem `Retry-After` utilizavel num 429, o Plantae fica em pausa por este tempo. */
export const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

/** Health check: reaproveita o ultimo resultado por este tempo, para nao gastar a cota. */
export const HEALTH_CACHE_MS = 60_000;
