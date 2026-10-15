/** Hosts da Graph API. O token de acesso vai no cabecalho, mas o destino NAO pode ser livre. */
export const OFFICIAL_GRAPH_BASE = 'https://graph.facebook.com';

/**
 * Hosts de servidor de TESTE aceitos para `WHATSAPP_API_BASE_URL` (Graph API falsa). Lista fechada,
 * pelo mesmo motivo do Telegram: um valor livre desviaria o token de acesso para fora.
 */
export const WHATSAPP_TEST_HOSTS: readonly string[] = ['whatsapp-fake', 'localhost', '127.0.0.1'];

export const GRAPH_VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/;
export const PHONE_NUMBER_ID_PATTERN = /^\d{5,20}$/;

export const SECRET_MIN_LENGTH = 16;
export const ACCESS_TOKEN_MIN_LENGTH = 20;

export type GraphBase =
  | { readonly ok: true; readonly base: string; readonly testServer: boolean }
  | { readonly ok: false; readonly problem: string };

/** Resolve a base da Graph API. Vazio = a oficial. Mensagens fixas: o valor nunca e repetido. */
export function resolveGraphBase(raw: unknown): GraphBase {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { ok: true, base: OFFICIAL_GRAPH_BASE, testServer: false };
  }
  if (typeof raw !== 'string') {
    return { ok: false, problem: 'nao e uma URL valida' };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, problem: 'nao e uma URL valida' };
  }
  if (url.protocol !== 'http:' || url.username !== '' || url.password !== '') {
    return { ok: false, problem: 'deve ser http, sem usuario ou senha (servidor de teste)' };
  }
  if (url.search !== '' || url.hash !== '' || url.pathname !== '/') {
    return { ok: false, problem: 'deve ser so o endereco (sem caminho, query ou fragmento)' };
  }
  if (!WHATSAPP_TEST_HOSTS.includes(url.hostname.toLowerCase())) {
    return {
      ok: false,
      problem: `o host deve ser um servidor de teste: ${WHATSAPP_TEST_HOSTS.join(', ')}`,
    };
  }
  return { ok: true, base: url.origin, testServer: true };
}

const plausible = (value: unknown, min: number): boolean =>
  typeof value === 'string' && value.length >= min && !/\s/.test(value);

/**
 * Plausibilidade dos valores informados (so quando presentes). Mensagens fixas: nenhum valor
 * - especialmente segredo - e repetido.
 */
type WhatsappEnvKey =
  | 'WHATSAPP_WEBHOOK_TOKEN'
  | 'WHATSAPP_APP_SECRET'
  | 'WHATSAPP_ACCESS_TOKEN'
  | 'WHATSAPP_PHONE_NUMBER_ID'
  | 'WHATSAPP_GRAPH_API_VERSION'
  | 'WHATSAPP_API_BASE_URL';

export function validateWhatsappSettings(env: Partial<Record<WhatsappEnvKey, unknown>>): string[] {
  const problems: string[] = [];
  const present = (key: WhatsappEnvKey): boolean => typeof env[key] === 'string' && env[key] !== '';
  if (
    present('WHATSAPP_WEBHOOK_TOKEN') &&
    !plausible(env.WHATSAPP_WEBHOOK_TOKEN, SECRET_MIN_LENGTH)
  ) {
    problems.push(
      `WHATSAPP_WEBHOOK_TOKEN invalido: use pelo menos ${String(SECRET_MIN_LENGTH)} caracteres, sem espacos`,
    );
  }
  if (present('WHATSAPP_APP_SECRET') && !plausible(env.WHATSAPP_APP_SECRET, SECRET_MIN_LENGTH)) {
    problems.push(
      `WHATSAPP_APP_SECRET invalido: use pelo menos ${String(SECRET_MIN_LENGTH)} caracteres, sem espacos`,
    );
  }
  if (
    present('WHATSAPP_ACCESS_TOKEN') &&
    !plausible(env.WHATSAPP_ACCESS_TOKEN, ACCESS_TOKEN_MIN_LENGTH)
  ) {
    problems.push(
      `WHATSAPP_ACCESS_TOKEN invalido: use pelo menos ${String(ACCESS_TOKEN_MIN_LENGTH)} caracteres, sem espacos`,
    );
  }
  if (
    present('WHATSAPP_PHONE_NUMBER_ID') &&
    !PHONE_NUMBER_ID_PATTERN.test(String(env.WHATSAPP_PHONE_NUMBER_ID))
  ) {
    problems.push('WHATSAPP_PHONE_NUMBER_ID invalido: use de 5 a 20 digitos');
  }
  if (
    present('WHATSAPP_GRAPH_API_VERSION') &&
    !GRAPH_VERSION_PATTERN.test(String(env.WHATSAPP_GRAPH_API_VERSION))
  ) {
    problems.push('WHATSAPP_GRAPH_API_VERSION invalida: use o formato v21.0');
  }
  if (present('WHATSAPP_API_BASE_URL')) {
    const base = resolveGraphBase(env.WHATSAPP_API_BASE_URL);
    if (!base.ok) {
      problems.push(`WHATSAPP_API_BASE_URL invalida: ${base.problem}`);
    }
  }
  if (present('WHATSAPP_WEBHOOK_TOKEN') && env.WHATSAPP_WEBHOOK_TOKEN === env.WHATSAPP_APP_SECRET) {
    problems.push('WHATSAPP_WEBHOOK_TOKEN e WHATSAPP_APP_SECRET devem ser diferentes');
  }
  return problems;
}
