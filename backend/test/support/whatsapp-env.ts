/**
 * Liga o WhatsApp nos e2e, contra uma Graph API FALSA em loopback. Importar ANTES do `app.module.ts`.
 * Tudo ficticio (segredos, token, ids); nenhuma conexao com a Meta.
 */
export const FAKE_GRAPH_PORT = 38780;
export const WA_WEBHOOK_TOKEN = 'token-de-verificacao-e2e-0123456789';
export const WA_APP_SECRET = 'app-secret-e2e-0123456789abcdef0123';
export const WA_ACCESS_TOKEN = 'EAAG-TOKEN-FALSO-e2e-0123456789abcdef';
export const WA_PHONE_NUMBER_ID = '1234567890';

process.env.WHATSAPP_ENABLED = 'true';
process.env.WHATSAPP_WEBHOOK_TOKEN = WA_WEBHOOK_TOKEN;
process.env.WHATSAPP_APP_SECRET = WA_APP_SECRET;
process.env.WHATSAPP_ACCESS_TOKEN = WA_ACCESS_TOKEN;
process.env.WHATSAPP_PHONE_NUMBER_ID = WA_PHONE_NUMBER_ID;
process.env.WHATSAPP_GRAPH_API_VERSION = 'v21.0';
process.env.WHATSAPP_API_BASE_URL = `http://127.0.0.1:${String(FAKE_GRAPH_PORT)}`;
