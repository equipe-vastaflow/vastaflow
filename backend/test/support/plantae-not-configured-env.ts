/**
 * Plantae habilitado, mas SEM token: o estado `NOT_CONFIGURED`.
 * Mesma regra de ordem de `plantae-enabled-env.ts`: tem de ser o primeiro import.
 */
process.env.PLANTAE_ENABLED = 'true';
process.env.PLANTAE_BASE_URL = 'https://rc.plantae.agr.br/api/v1/external';
delete process.env.PLANTAE_API_TOKEN;
