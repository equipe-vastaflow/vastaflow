/**
 * Plantae no host de PRODUCAO com o comando de chat LIGADO e o atestado da organizacao dado (o estado em que o
 * `/contas_pagar` responde), token FALSO. Importar ANTES do `app.module.ts`. Nenhuma chamada real.
 */
process.env.PLANTAE_ENABLED = 'true';
process.env.PLANTAE_BASE_URL = 'https://web.plantae.agr.br/api/v1/external';
process.env.PLANTAE_API_TOKEN = 'plt_TOKEN_FALSO_apenas_para_testes_0123456789abcdef';
process.env.PLANTAE_CHAT_COMMANDS_ENABLED = 'true';
process.env.PLANTAE_ORGANIZATION_CONFIRMED = 'true';
delete process.env.PLANTAE_CHAT_SHOW_PAYEE_NAME;
