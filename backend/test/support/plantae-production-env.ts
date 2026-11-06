/**
 * Plantae no host de PRODUCAO (`web.plantae.agr.br`), token FALSO, nos e2e. Os comandos de chat e o atestado da
 * organizacao ficam NO PADRAO (desligados). Importar ANTES do `app.module.ts` (mesma regra de `plantae-enabled-env.ts`).
 *
 * Nenhuma chamada real: o `fetch` e substituido em cada teste.
 */
process.env.PLANTAE_ENABLED = 'true';
process.env.PLANTAE_BASE_URL = 'https://web.plantae.agr.br/api/v1/external';
process.env.PLANTAE_API_TOKEN = 'plt_TOKEN_FALSO_apenas_para_testes_0123456789abcdef';
delete process.env.PLANTAE_CHAT_COMMANDS_ENABLED;
delete process.env.PLANTAE_ORGANIZATION_CONFIRMED;
delete process.env.PLANTAE_CHAT_SHOW_PAYEE_NAME;
