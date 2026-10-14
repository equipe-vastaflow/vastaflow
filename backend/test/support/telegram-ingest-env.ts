/**
 * Liga, nos e2e, a entrada de mensagens do Telegram pelo n8n e o comando
 * `/contas_pagar` (Plantae em homologacao, token FALSO).
 *
 * Precisa ser importado ANTES do `app.module.ts` (o ConfigModule valida o ambiente
 * na importacao). A chave e so de teste; nada aqui e credencial real, e nenhuma
 * chamada real sai: o `fetch` e substituido em cada teste.
 */
import './plantae-enabled-env';

export const INGEST_KEY_E2E = 'chave-e2e-de-assinatura-com-mais-de-32-caracteres';

process.env.TELEGRAM_INGEST_SIGNING_KEY = INGEST_KEY_E2E;
process.env.PLANTAE_CHAT_COMMANDS_ENABLED = 'true';
// Organizacao FICTICIA confirmada, so para exercitar o comando com `fetch` simulado.
process.env.PLANTAE_ORGANIZATION_CONFIRMED = 'true';
