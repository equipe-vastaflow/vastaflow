/**
 * Configuracao do gateway, lida SO aqui (e em `main.ts`). Mensagens de erro FIXAS: nenhum valor informado - em
 * especial o token - e repetido. Segredo vem de ARQUIVO (`..._FILE`, montado somente leitura) ou, em desenvolvimento,
 * de variavel; nunca de argumento de linha de comando.
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
 * @param readFile leitura do arquivo de segredo (injetada: o teste nao toca o disco).
 * @throws {ConfigError} com TODOS os problemas, sem repetir valores.
 */
export function loadConfig(env: EnvReader, readFile: (path: string) => string): GatewayConfig {
  const problems: string[] = [];

  const backend = parseBackendUrl(env.GATEWAY_BACKEND_URL);
  if (backend.problem !== undefined) {
    problems.push(backend.problem);
  }

  let token = '';
  const tokenFile = env.GATEWAY_SERVICE_TOKEN_FILE;
  if (tokenFile !== undefined && tokenFile.trim() !== '') {
    try {
      token = readFile(tokenFile.trim()).trim();
    } catch {
      problems.push('GATEWAY_SERVICE_TOKEN_FILE ilegivel');
    }
  } else if (env.GATEWAY_SERVICE_TOKEN !== undefined) {
    token = env.GATEWAY_SERVICE_TOKEN.trim();
  }
  if (token === '' && !problems.includes('GATEWAY_SERVICE_TOKEN_FILE ilegivel')) {
    problems.push('credencial de servico ausente (GATEWAY_SERVICE_TOKEN_FILE)');
  } else if (token !== '' && !TOKEN_FORMAT.test(token)) {
    problems.push('credencial de servico em formato invalido');
  }

  const account = (env.GATEWAY_ACCOUNT ?? '').trim();
  if (!ACCOUNT_FORMAT.test(account)) {
    problems.push('GATEWAY_ACCOUNT deve ter de 5 a 20 digitos');
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
  };
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
}
