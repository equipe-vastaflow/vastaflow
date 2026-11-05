import { parseEncryptionKey } from './session-crypto.js';

/**
 * Configuracao do gateway, lida SO aqui (e em `main.ts`). Mensagens de erro FIXAS: nenhum valor informado - em
 * especial token, senha do banco e chave de cifra - e repetido. Segredo vem de ARQUIVO (`..._FILE`, montado somente
 * leitura) ou, so em desenvolvimento, de variavel; nunca de argumento de linha de comando, e NUNCA tem valor padrao.
 */
export interface GatewayConfig {
  readonly backendUrl: string;
  readonly serviceToken: string;
  /** Numero (so digitos) da conta do bot: o `to` de toda mensagem. A conta que conectar tem de ser esta. */
  readonly account: string;
  readonly ingestTimeoutMs: number;
  readonly sendTimeoutMs: number;
  readonly maxRepliesPerMinute: number;
  readonly maxQueue: number;
  /** Identificador da sessao no banco (varias contas no futuro = varias sessoes). */
  readonly sessionId: string;
  /**
   * Interruptor da conexao com o WhatsApp. PADRAO `false`: o processo so valida a configuracao, a chave e o banco
   * (verificacao) e sai. Ligar e decisao da etapa de pareamento/teste real.
   */
  readonly connectEnabled: boolean;
  readonly db: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
  };
  /** Chave AES-256 (32 bytes) que cifra a sessao. Exclusiva do gateway. */
  readonly encryptionKey: Uint8Array;
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`configuracao invalida: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

/** Mesmo formato da credencial de servico do backend: prefixo `vfs_` + 43 caracteres base64url. */
const TOKEN_FORMAT = /^vfs_[A-Za-z0-9_-]{43}$/;
const ACCOUNT_FORMAT = /^\d{5,20}$/;
const SESSION_ID_FORMAT = /^[a-z0-9-]{1,32}$/;
const DB_NAME_FORMAT = /^[A-Za-z0-9_]{1,64}$/;
const DB_HOST_FORMAT = /^[A-Za-z0-9.-]{1,253}$/;
/** Hosts em texto claro aceitos: nome simples do Docker (sem ponto) ou loopback. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export type EnvReader = Readonly<Record<string, string | undefined>>;

function parseBackendUrl(raw: string | undefined): { url?: string; problem?: string } {
  if (raw === undefined || raw.trim() === '') {
    return { problem: 'GATEWAY_BACKEND_URL ausente' };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { problem: 'GATEWAY_BACKEND_URL nao e uma URL valida' };
  }
  if (url.username !== '' || url.password !== '') {
    return { problem: 'GATEWAY_BACKEND_URL nao pode conter usuario ou senha' };
  }
  if (url.search !== '' || url.hash !== '' || url.pathname !== '/') {
    return {
      problem: 'GATEWAY_BACKEND_URL deve ser so a origem (sem caminho, query ou fragmento)',
    };
  }
  if (url.protocol === 'https:') {
    return { url: url.origin };
  }
  if (url.protocol === 'http:' && (!url.hostname.includes('.') || LOOPBACK.has(url.hostname))) {
    return { url: url.origin };
  }
  return {
    problem:
      'GATEWAY_BACKEND_URL deve ser https, ou http apenas para a rede interna (host sem ponto, ex.: http://backend:3000)',
  };
}

function intInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
  problems: string[],
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} deve ser um inteiro entre ${String(min)} e ${String(max)}`);
    return fallback;
  }
  return n;
}

/**
 * Segredo por ARQUIVO (preferido) ou variavel. Devolve `''` e registra o problema (sem o valor) se faltar ou ilegivel.
 * O arquivo tem precedencia sobre a variavel.
 */
function readSecret(
  env: EnvReader,
  base: string,
  readFile: (path: string) => string,
  label: string,
  problems: string[],
): string {
  const file = env[`${base}_FILE`];
  if (file !== undefined && file.trim() !== '') {
    try {
      const value = readFile(file.trim()).trim();
      if (value === '') {
        problems.push(`${label} ausente`);
      }
      return value;
    } catch {
      problems.push(`${base}_FILE ilegivel`);
      return '';
    }
  }
  const value = (env[base] ?? '').trim();
  if (value === '') {
    problems.push(`${label} ausente (${base}_FILE)`);
  }
  return value;
}

/**
 * @param readFile leitura do arquivo de segredo (injetada: o teste nao toca o disco).
 * @throws {ConfigError} com TODOS os problemas, sem repetir valores.
 */
export function loadConfig(env: EnvReader, readFile: (path: string) => string): GatewayConfig {
  const problems: string[] = [];

  const backend = parseBackendUrl(env.GATEWAY_BACKEND_URL);
  if (backend.problem !== undefined) {
    problems.push(backend.problem);
  }

  const token = readSecret(
    env,
    'GATEWAY_SERVICE_TOKEN',
    readFile,
    'credencial de servico',
    problems,
  );
  if (token !== '' && !TOKEN_FORMAT.test(token)) {
    problems.push('credencial de servico em formato invalido');
  }

  const account = (env.GATEWAY_ACCOUNT ?? '').trim();
  if (!ACCOUNT_FORMAT.test(account)) {
    problems.push('GATEWAY_ACCOUNT deve ter de 5 a 20 digitos');
  }

  const sessionId = (env.GATEWAY_SESSION_ID ?? 'principal').trim();
  if (!SESSION_ID_FORMAT.test(sessionId)) {
    problems.push(
      'GATEWAY_SESSION_ID deve ter de 1 a 32 caracteres: letras minusculas, digitos e hifen',
    );
  }

  const connect = (env.GATEWAY_CONNECT_ENABLED ?? '').trim();
  if (connect !== '' && connect !== 'true' && connect !== 'false') {
    problems.push("GATEWAY_CONNECT_ENABLED deve ser 'true' ou 'false'");
  }

  // ---- banco da sessao ----
  const dbHost = (env.GATEWAY_DB_HOST ?? '').trim();
  if (!DB_HOST_FORMAT.test(dbHost)) {
    problems.push('GATEWAY_DB_HOST ausente ou invalido');
  }
  const dbName = (env.GATEWAY_DB_NAME ?? '').trim();
  if (!DB_NAME_FORMAT.test(dbName)) {
    problems.push('GATEWAY_DB_NAME ausente ou invalido');
  }
  const dbUser = (env.GATEWAY_DB_USER ?? '').trim();
  if (dbUser === '' || dbUser.length > 80) {
    problems.push('GATEWAY_DB_USER ausente ou invalido');
  }
  const dbPort = intInRange(env.GATEWAY_DB_PORT, 3306, 1, 65_535, 'GATEWAY_DB_PORT', problems);
  const dbPassword = readSecret(env, 'GATEWAY_DB_PASSWORD', readFile, 'senha do banco', problems);

  // ---- chave de cifra da sessao: obrigatoria, sem padrao, formato estrito ----
  const rawKey = readSecret(
    env,
    'GATEWAY_AUTH_ENCRYPTION_KEY',
    readFile,
    'chave de cifra da sessao',
    problems,
  );
  let encryptionKey: Uint8Array = Buffer.alloc(0);
  if (rawKey !== '') {
    const parsed = parseEncryptionKey(rawKey);
    if (parsed === null) {
      problems.push(
        'chave de cifra da sessao invalida (use 32 bytes aleatorios em base64 ou 64 caracteres hexadecimais)',
      );
    } else {
      encryptionKey = parsed;
    }
  }

  const config: GatewayConfig = {
    backendUrl: backend.url ?? '',
    serviceToken: token,
    account,
    ingestTimeoutMs: intInRange(
      env.GATEWAY_INGEST_TIMEOUT_MS,
      10_000,
      1_000,
      60_000,
      'GATEWAY_INGEST_TIMEOUT_MS',
      problems,
    ),
    sendTimeoutMs: intInRange(
      env.GATEWAY_SEND_TIMEOUT_MS,
      15_000,
      1_000,
      60_000,
      'GATEWAY_SEND_TIMEOUT_MS',
      problems,
    ),
    maxRepliesPerMinute: intInRange(
      env.GATEWAY_MAX_REPLIES_PER_MINUTE,
      20,
      1,
      120,
      'GATEWAY_MAX_REPLIES_PER_MINUTE',
      problems,
    ),
    maxQueue: intInRange(env.GATEWAY_MAX_QUEUE, 100, 1, 1_000, 'GATEWAY_MAX_QUEUE', problems),
    sessionId,
    connectEnabled: connect === 'true',
    db: { host: dbHost, port: dbPort, database: dbName, user: dbUser, password: dbPassword },
    encryptionKey,
  };
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
}
