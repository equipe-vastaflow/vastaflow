import type { ConfigReader } from '../integration-config';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  PLANTAE_API_PATH,
  PLANTAE_BASE_URL_KEY,
  PLANTAE_ENABLED_KEY,
  PLANTAE_ENVIRONMENTS,
  PLANTAE_TIMEOUT_MS_KEY,
  type PlantaeEnvironment,
} from './plantae.constants';

/**
 * Configuracao NAO SECRETA da integracao. O token NAO esta aqui, de proposito:
 * um objeto de configuracao e o tipo de coisa que acaba num `console.log` ou
 * num relatorio. O token e lido pelo cliente HTTP, na hora de montar o cabecalho.
 */
export interface PlantaeSettings {
  readonly enabled: boolean;
  /** URL base normalizada (`https://host/api/v1/external`), ou `null` se ausente/invalida. */
  readonly baseUrl: string | null;
  readonly environment: PlantaeEnvironment | null;
  readonly timeoutMs: number;
}

export type BaseUrlResult =
  | { readonly ok: true; readonly baseUrl: string; readonly environment: PlantaeEnvironment }
  | { readonly ok: false; readonly problem: string };

/**
 * Valida e normaliza a URL base.
 *
 * Regras, todas com mensagem fixa (a URL informada pode conter credencial, entao
 * NUNCA e repetida no erro):
 * - HTTPS obrigatorio;
 * - sem usuario/senha, porta, query string ou fragmento;
 * - host na lista de ambientes conhecidos (so homologacao);
 * - caminho exatamente `/api/v1/external` (uma barra final e tolerada).
 */
export function parsePlantaeBaseUrl(raw: string): BaseUrlResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, problem: 'nao e uma URL valida' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, problem: 'deve usar https' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, problem: 'nao pode conter usuario ou senha' };
  }
  if (url.port !== '') {
    return { ok: false, problem: 'nao pode conter porta' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, problem: 'nao pode conter query string nem fragmento' };
  }
  const environment = PLANTAE_ENVIRONMENTS[url.hostname.toLowerCase()];
  if (environment === undefined) {
    return { ok: false, problem: 'o host nao e um ambiente Plantae conhecido' };
  }
  if (url.pathname.replace(/\/+$/, '') !== PLANTAE_API_PATH) {
    return { ok: false, problem: `o caminho deve ser ${PLANTAE_API_PATH}` };
  }
  return {
    ok: true,
    baseUrl: `https://${url.hostname.toLowerCase()}${PLANTAE_API_PATH}`,
    environment,
  };
}

const TOKEN_FORMAT = /^[\x21-\x7E]{8,512}$/;

/**
 * Formato plausivel do token: ASCII imprimivel, sem espaco, de 8 a 512
 * caracteres. NAO tenta adivinhar o formato real da chave da Plantae (nao ha
 * documentacao dele); so impede o que quebraria ou injetaria no cabecalho
 * `Authorization` - espaco, quebra de linha, caractere de controle.
 */
export function isPlausibleToken(token: string): boolean {
  return TOKEN_FORMAT.test(token);
}

/** Booleano vindo do `.env` (`'true'`) ou ja convertido pelo `validateEnv`. */
function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function resolveTimeout(value: unknown): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' &&
    Number.isInteger(parsed) &&
    parsed >= MIN_TIMEOUT_MS &&
    parsed <= MAX_TIMEOUT_MS
    ? parsed
    : DEFAULT_TIMEOUT_MS;
}

/**
 * Le a configuracao no momento do uso. URL invalida resolve para `baseUrl: null`
 * (fail-closed: a integracao fica `NOT_CONFIGURED`); a recusa ruidosa de uma URL
 * errada acontece no boot, em `validateEnv`.
 */
export function resolvePlantaeSettings(config: ConfigReader): PlantaeSettings {
  const rawUrl = config.get<unknown>(PLANTAE_BASE_URL_KEY);
  const parsed =
    typeof rawUrl === 'string' && rawUrl.trim() !== '' ? parsePlantaeBaseUrl(rawUrl) : null;
  return {
    enabled: isTrue(config.get<unknown>(PLANTAE_ENABLED_KEY)),
    baseUrl: parsed?.ok ? parsed.baseUrl : null,
    environment: parsed?.ok ? parsed.environment : null,
    timeoutMs: resolveTimeout(config.get<unknown>(PLANTAE_TIMEOUT_MS_KEY)),
  };
}
