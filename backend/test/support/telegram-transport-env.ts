/**
 * Liga, nos e2e do TRANSPORTE, o polling real contra o Bot API FALSO e a entrega ao
 * "n8n" falso, ambos em loopback. Importar ANTES do `app.module.ts` (o ConfigModule
 * valida o ambiente na importacao).
 *
 * Tudo ficticio: token, ids, chave. Nenhuma conexao com api.telegram.org: a base da API
 * aponta para o servidor de teste (lista fechada de hosts em `telegram-api-base.ts`).
 */
export const FAKE_TELEGRAM_PORT = 38770;
export const FAKE_N8N_PORT = 38771;
export const TRANSPORT_KEY_E2E = 'chave-e2e-do-transporte-com-mais-de-32-caracteres';
export const RATE_LIMIT_E2E = 30;
export const FAKE_BOT_TOKEN = '999000111:AAFAKEfakeFAKEfake_token_so_para_testes_0123456789';

process.env.TELEGRAM_BOT_TOKEN = FAKE_BOT_TOKEN;
process.env.TELEGRAM_POLLING_ENABLED = 'true';
process.env.TELEGRAM_DELIVERY_MODE = 'n8n';
process.env.TELEGRAM_API_BASE_URL = `http://127.0.0.1:${String(FAKE_TELEGRAM_PORT)}`;
process.env.TELEGRAM_N8N_WEBHOOK_URL = `http://127.0.0.1:${String(FAKE_N8N_PORT)}/webhook/vastaflow-telegram`;
process.env.TELEGRAM_INGEST_SIGNING_KEY = TRANSPORT_KEY_E2E;
// O Plantae fica DESLIGADO (cenario K): o comando de chat esta ligado, a integracao nao.
process.env.PLANTAE_ENABLED = 'false';
process.env.PLANTAE_CHAT_COMMANDS_ENABLED = 'true';
process.env.PLANTAE_ORGANIZATION_CONFIRMED = 'true';
// Folga para a suite inteira usar o mesmo remetente; o teste de abuso envia mais que isto.
process.env.TELEGRAM_USER_RATE_LIMIT_PER_MINUTE = '30';
