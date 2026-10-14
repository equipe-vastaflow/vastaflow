import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Privacidade do n8n (Fase 5.3), travada no Compose de producao. O n8n NAO deixa de gravar a
 * execucao quando se manda "nao salvar": ele grava o corpo do webhook (texto do comando, ids do
 * Telegram e o envelope assinado) ao iniciar e, ao terminar, so marca como apagada; o apagamento
 * fisico espera o buffer e a varredura. Estas configuracoes encurtam essa janela - e este teste
 * impede que alguem a alargue sem perceber.
 */
const COMPOSE = readFileSync(
  join(__dirname, '../../docker-compose.production.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

/** Bloco do servico `n8n` (do cabecalho ate o proximo servico/secao de nivel 2). */
function blocoDoN8n(): string {
  const inicio = COMPOSE.indexOf('\n  n8n:\n');
  const fim = COMPOSE.indexOf('\nnetworks:', inicio);
  expect(inicio).toBeGreaterThan(-1);
  return COMPOSE.slice(inicio, fim);
}

const env = (bloco: string, chave: string): string | undefined =>
  new RegExp(`^\\s+${chave}:\\s*'?([^'\\n#]+?)'?\\s*(#.*)?$`, 'm').exec(bloco)?.[1];

describe('Compose: privacidade das execucoes do n8n', () => {
  const n8n = blocoDoN8n();

  it.each([
    ['EXECUTIONS_DATA_SAVE_ON_SUCCESS', 'none'],
    ['EXECUTIONS_DATA_SAVE_ON_ERROR', 'none'],
    ['EXECUTIONS_DATA_SAVE_ON_PROGRESS', 'false'],
    ['EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS', 'false'],
  ])('%s = %s (nao pedir ao n8n que guarde conteudo)', (chave, valor) => {
    expect(env(n8n, chave)).toBe(valor);
  });

  it('apagamento fisico sem espera: buffer 0 e varredura de 1 minuto', () => {
    expect(env(n8n, 'EXECUTIONS_DATA_HARD_DELETE_BUFFER')).toBe('0');
    expect(env(n8n, 'EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL')).toBe('1');
  });

  it('a poda continua ligada (sem ela nada seria apagado)', () => {
    expect(env(n8n, 'EXECUTIONS_DATA_PRUNE')).toBe('true');
  });

  it('o n8n nao recebe segredos do Telegram, do Plantae nem a chave de assinatura', () => {
    expect(n8n).not.toMatch(/TELEGRAM_|PLANTAE_|INGEST_SIGNING/);
  });

  it('o editor do n8n so e publicado em loopback', () => {
    expect(n8n).toMatch(/- '127\.0\.0\.1:\$\{N8N_EDITOR_PORT:-5678\}:5678'/);
    expect(n8n).not.toMatch(/- '0\.0\.0\.0:/);
  });
});
