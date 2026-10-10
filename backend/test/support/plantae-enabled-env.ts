/**
 * Liga o Plantae nos e2e (homologacao, token FALSO).
 *
 * Precisa ser o PRIMEIRO import do arquivo de teste: o `ConfigModule` valida o
 * ambiente quando `app.module.ts` e importado, e `PLANTAE_ENABLED` tem valor
 * padrao - entao mudar a variavel depois do import nao teria efeito. Importar
 * este arquivo antes garante a ordem (os imports rodam na ordem em que aparecem).
 *
 * Nenhuma chamada real: o `fetch` e substituido em cada teste.
 */
process.env.PLANTAE_ENABLED = 'true';
process.env.PLANTAE_BASE_URL = 'https://rc.plantae.agr.br/api/v1/external';
process.env.PLANTAE_API_TOKEN = 'plt_TOKEN_FALSO_apenas_para_testes_0123456789abcdef';
