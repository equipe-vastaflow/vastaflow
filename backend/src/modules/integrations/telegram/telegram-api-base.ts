/** Chave do ambiente que redireciona a Bot API para um servidor de TESTE. */
export const TELEGRAM_API_BASE_URL_KEY = 'TELEGRAM_API_BASE_URL';

/** Endereco oficial. Sem a variavel acima, e o UNICO destino do token do bot. */
export const OFFICIAL_TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Hosts de servidor de teste aceitos. `telegram-fake` e o nome do servico do Bot API
 * falso no Compose de teste (`backend/test/fake-telegram/`); o loopback serve ao
 * desenvolvimento local.
 *
 * POR QUE UMA LISTA FECHADA. A URL da Bot API carrega o token do bot
 * (`/bot<token>/metodo`). Uma variavel que aceitasse qualquer host permitiria desviar
 * o token para fora com um unico erro de configuracao. Aqui o desvio so alcanca nomes
 * que existem na rede interna do teste, nunca a internet: a variavel nao e um jeito de
 * usar outro provedor, e uma excecao para teste. Em producao fica vazia.
 */
export const TELEGRAM_TEST_SERVER_HOSTS: readonly string[] = [
  'telegram-fake',
  'localhost',
  '127.0.0.1',
];

export type TelegramApiBase =
  | { readonly ok: true; readonly base: string; readonly testServer: boolean }
  | { readonly ok: false; readonly problem: string };

/**
 * Resolve a base da Bot API. Vazio/ausente = a oficial. Mensagens fixas: o valor
 * informado nunca e repetido no erro.
 */
export function resolveTelegramApiBase(raw: unknown): TelegramApiBase {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { ok: true, base: OFFICIAL_TELEGRAM_API_BASE, testServer: false };
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
  if (url.protocol !== 'http:') {
    return { ok: false, problem: 'deve usar http (servidor de teste, sem TLS)' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, problem: 'nao pode conter usuario ou senha' };
  }
  if (url.search !== '' || url.hash !== '' || url.pathname !== '/') {
    return { ok: false, problem: 'deve ser so o endereco (sem caminho, query ou fragmento)' };
  }
  if (!TELEGRAM_TEST_SERVER_HOSTS.includes(url.hostname.toLowerCase())) {
    return {
      ok: false,
      problem: `o host deve ser um servidor de teste: ${TELEGRAM_TEST_SERVER_HOSTS.join(', ')}`,
    };
  }
  return { ok: true, base: url.origin, testServer: true };
}
