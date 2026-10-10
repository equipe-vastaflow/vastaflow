import type { ConfigReader } from '../integration-config';
import { PlantaeApiError, type PlantaeFailure } from './plantae-errors';
import { parsePlantaeJson } from './plantae-json';
import { PlantaeRateLimiter } from './plantae-rate-limiter';
import { isPlausibleToken, resolvePlantaeSettings } from './plantae-settings';
import {
  DEFAULT_RATE_LIMIT_PAUSE_MS,
  MAX_ATTEMPTS,
  MAX_AUTOMATIC_RETRY_AFTER_MS,
  MAX_RESPONSE_BYTES,
  PLANTAE_API_TOKEN_KEY,
  RATE_LIMIT_WINDOW_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_JITTER_MS,
  type PlantaeEndpointPath,
} from './plantae.constants';

/** Dependencias substituiveis nos testes. Em producao, tudo usa o padrao. */
export interface PlantaeClientDeps {
  readonly fetch?: typeof fetch;
  readonly limiter?: PlantaeRateLimiter;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
  /**
   * Tentativas por chamada. `1` = nunca repete (usado na validacao manual contra o
   * Plantae real, onde nada pode ser reenviado sozinho). So pode REDUZIR: valores
   * acima de `MAX_ATTEMPTS` valem `MAX_ATTEMPTS`.
   */
  readonly maxAttempts?: number;
}

type Attempt =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly error: PlantaeApiError; readonly retryAfterMs?: number };

/** Corpo de erro lido so para extrair NOMES de parametros: teto pequeno. */
const ERROR_BODY_LIMIT = 64 * 1024;
const PARAMETER_NAME = /^[a-z][a-z_]{0,39}$/;
const MAX_REPORTED_PARAMETERS = 10;

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'HOSTNAME_MISMATCH',
]);

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Codigo do erro do `fetch` do Node: fica em `error.cause.code` (undici). */
function errorCode(error: unknown): string | undefined {
  const read = (value: unknown): string | undefined => {
    if (typeof value === 'object' && value !== null && 'code' in value) {
      const { code } = value;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  };
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : null;
  return read(cause) ?? read(error);
}

/**
 * Classifica a falha de rede em categoria fixa. O erro original e DESCARTADO:
 * a mensagem dele pode conter a URL.
 */
function classifyNetworkError(error: unknown, timedOut: boolean): PlantaeFailure {
  if (timedOut) {
    return 'timeout';
  }
  const code = errorCode(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'dns';
  }
  if (code === 'ECONNREFUSED') {
    return 'connection-refused';
  }
  if (
    code !== undefined &&
    (TLS_CODES.has(code) || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL'))
  ) {
    return 'tls';
  }
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
}

/** Teto de qualquer pausa pedida pelo Plantae: um `Retry-After` absurdo nao trava a integracao por anos. */
const MAX_PAUSE_MS = 24 * 60 * 60 * 1000;
/** Data HTTP no formato fixo (`Wed, 21 Oct 2026 07:28:00 GMT`). Nada mais e aceito como data. */
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Segundos inteiros ou data HTTP -> milissegundos; `undefined` se nao for
 * utilizavel. `Date.parse` sozinho NAO serve: ele le `-5` e `1.5` como datas.
 */
function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (header === null) {
    return undefined;
  }
  const text = header.trim();
  if (/^\d{1,9}$/.test(text)) {
    return Math.min(Number(text) * 1000, MAX_PAUSE_MS);
  }
  if (HTTP_DATE.test(text)) {
    const date = Date.parse(text);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - now), MAX_PAUSE_MS);
    }
  }
  return undefined;
}

async function readBody(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new PlantaeApiError('response-too-large');
  }
  // `for await` cancela o fluxo ao sair (`throw`/`break`): nao sobra conexao presa.
  const body = response.body as AsyncIterable<Uint8Array> | null;
  if (body === null) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > limit) {
      throw new PlantaeApiError('response-too-large');
    }
    chunks.push(chunk);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new PlantaeApiError('invalid-response', { where: 'corpo [utf-8]' });
  }
}

/** Nomes dos parametros que o Plantae rejeitou no 422. Nunca as mensagens, que podem repetir valores. */
function rejectedParameters(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || !('errors' in parsed)) {
      return [];
    }
    const { errors } = parsed;
    if (typeof errors !== 'object' || errors === null) {
      return [];
    }
    return Object.keys(errors)
      .map((key) => key.split('.')[0] ?? '')
      .filter((name) => PARAMETER_NAME.test(name))
      .slice(0, MAX_REPORTED_PARAMETERS);
  } catch {
    return [];
  }
}

/**
 * Cliente HTTP da API externa do Plantae. Somente `GET`.
 *
 * E o UNICO arquivo do modulo que chama `fetch`. Cada chamada:
 * - le a configuracao e o token na hora, pela configuracao do Nest: nada fica
 *   guardado em campo de classe, e nada e logado aqui;
 * - sem integracao habilitada, sem URL ou sem token, falha ANTES da rede;
 * - envia o token SO no cabecalho `Authorization` - nunca em URL, query ou corpo;
 * - nao segue redirect (`redirect: 'manual'`): um 3xx e erro, nao um salto para
 *   um destino que ninguem validou;
 * - tem timeout, teto de tamanho de corpo e tentativas limitadas;
 * - passa pelo limitador local e respeita `Retry-After` e `X-RateLimit-*`.
 *
 * O erro que sai e sempre `PlantaeApiError` com categoria fixa.
 */
export class PlantaeHttpClient {
  private readonly limiter: PlantaeRateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly maxAttempts: number;

  constructor(
    private readonly config: ConfigReader,
    private readonly deps: PlantaeClientDeps = {},
  ) {
    this.limiter = deps.limiter ?? new PlantaeRateLimiter();
    this.sleep = deps.sleep ?? realSleep;
    this.random = deps.random ?? Math.random;
    this.now = deps.now ?? ((): number => Date.now());
    // Valor invalido (NaN, infinito, < 1) NUNCA vira "sem limite": cai em 1 tentativa.
    const requested = Number.isFinite(deps.maxAttempts) ? Math.floor(deps.maxAttempts ?? 1) : 1;
    this.maxAttempts =
      deps.maxAttempts === undefined
        ? MAX_ATTEMPTS
        : Math.min(Math.max(1, requested), MAX_ATTEMPTS);
  }

  /**
   * Ha integracao habilitada, com URL valida e token plausivel. So a presenca:
   * o valor do token nunca e devolvido.
   */
  isConfigured(): boolean {
    const settings = resolvePlantaeSettings(this.config);
    return settings.enabled && settings.baseUrl !== null && this.readToken() !== null;
  }

  private readToken(): string | null {
    const raw = this.config.get<unknown>(PLANTAE_API_TOKEN_KEY);
    if (typeof raw !== 'string') {
      return null;
    }
    const token = raw.trim();
    return isPlausibleToken(token) ? token : null;
  }

  /** `GET` de um endpoint documentado. Devolve o JSON ja analisado (numeros como `PlantaeNumber`). */
  async get(endpoint: PlantaeEndpointPath, params: URLSearchParams): Promise<unknown> {
    const settings = resolvePlantaeSettings(this.config);
    if (!settings.enabled) {
      throw new PlantaeApiError('disabled');
    }
    const token = this.readToken();
    if (settings.baseUrl === null || token === null) {
      throw new PlantaeApiError('not-configured');
    }
    const query = params.toString();
    const url = `${settings.baseUrl}${endpoint}${query === '' ? '' : `?${query}`}`;

    for (let attempt = 1; ; attempt += 1) {
      const release = await this.limiter.acquire();
      let outcome: Attempt;
      try {
        outcome = await this.attemptOnce(url, token, settings.timeoutMs);
      } finally {
        release();
      }
      if (outcome.ok) {
        return outcome.body;
      }
      if (attempt >= this.maxAttempts || !this.isRetryable(outcome)) {
        throw outcome.error;
      }
      await this.sleep(this.retryDelay(outcome, attempt));
    }
  }

  private isRetryable(outcome: Extract<Attempt, { ok: false }>): boolean {
    switch (outcome.error.kind) {
      case 'rate-limited':
        // So repete se a pausa cabe na espera; senao o chamador recebe o 429.
        return (
          outcome.retryAfterMs !== undefined && outcome.retryAfterMs <= MAX_AUTOMATIC_RETRY_AFTER_MS
        );
      case 'server-error':
      case 'timeout':
      case 'network':
      case 'connection-refused':
        return true;
      default:
        return false;
    }
  }

  private retryDelay(outcome: Extract<Attempt, { ok: false }>, attempt: number): number {
    if (outcome.error.kind === 'rate-limited') {
      // A pausa ja foi registrada no limitador; a proxima `acquire` espera o resto.
      return 0;
    }
    return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(this.random() * RETRY_JITTER_MS);
  }

  private async attemptOnce(url: string, token: string, timeoutMs: number): Promise<Attempt> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const doFetch = this.deps.fetch ?? fetch;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        redirect: 'manual',
        signal: timeout,
      });
    } catch (error) {
      return {
        ok: false,
        error: new PlantaeApiError(classifyNetworkError(error, timeout.aborted)),
      };
    }

    try {
      return await this.interpret(response);
    } catch (error) {
      if (error instanceof PlantaeApiError) {
        return { ok: false, error };
      }
      return {
        ok: false,
        error: new PlantaeApiError(classifyNetworkError(error, timeout.aborted)),
      };
    }
  }

  private async interpret(response: Response): Promise<Attempt> {
    const { status } = response;
    this.noteRateLimit(response);

    if (status >= 300 && status < 400) {
      await this.discard(response);
      return { ok: false, error: new PlantaeApiError('redirect', { httpStatus: status }) };
    }
    if (status === 200) {
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('json')) {
        await this.discard(response);
        return {
          ok: false,
          error: new PlantaeApiError('invalid-response', { where: 'content-type [json]' }),
        };
      }
      const text = await readBody(response, MAX_RESPONSE_BYTES);
      return { ok: true, body: parsePlantaeJson(text) };
    }
    if (status === 401) {
      await this.discard(response);
      return { ok: false, error: new PlantaeApiError('unauthorized', { httpStatus: status }) };
    }
    if (status === 403) {
      await this.discard(response);
      return { ok: false, error: new PlantaeApiError('forbidden', { httpStatus: status }) };
    }
    if (status === 422) {
      const parameters = rejectedParameters(
        await readBody(response, ERROR_BODY_LIMIT).catch(() => ''),
      );
      return {
        ok: false,
        error: new PlantaeApiError('rejected-parameters', { httpStatus: status, parameters }),
      };
    }
    if (status === 429) {
      await this.discard(response);
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.now());
      this.limiter.blockFor(retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS);
      return {
        ok: false,
        retryAfterMs,
        error: new PlantaeApiError('rate-limited', {
          httpStatus: status,
          retryAfterSeconds: Math.ceil((retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS) / 1000),
        }),
      };
    }
    await this.discard(response);
    return {
      ok: false,
      error: new PlantaeApiError(status >= 500 ? 'server-error' : 'http', { httpStatus: status }),
    };
  }

  /** `X-RateLimit-Remaining: 0` -> a proxima chamada seria 429; espera a janela. */
  private noteRateLimit(response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining !== null && /^\d+$/.test(remaining.trim()) && Number(remaining) === 0) {
      this.limiter.blockFor(RATE_LIMIT_WINDOW_MS);
    }
  }

  /** Descarta o corpo que nao vai ser usado, liberando a conexao. */
  private async discard(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // Nada a fazer: a conexao sera descartada de qualquer forma.
    }
  }
}
