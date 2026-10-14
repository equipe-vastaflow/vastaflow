/**
 * Ambiente dos e2e dos PORTOES do comando financeiro: comando de chat ligado, Plantae DESLIGADO
 * e organizacao NAO confirmada (o padrao seguro). Importar ANTES do `app.module.ts`.
 * Tudo ficticio; nenhuma chamada real.
 */
export const GATES_KEY_E2E = 'chave-e2e-dos-portoes-com-mais-de-32-caracteres';

process.env.TELEGRAM_INGEST_SIGNING_KEY = GATES_KEY_E2E;
process.env.PLANTAE_CHAT_COMMANDS_ENABLED = 'true';
process.env.PLANTAE_ENABLED = 'false';
delete process.env.PLANTAE_ORGANIZATION_CONFIRMED;
