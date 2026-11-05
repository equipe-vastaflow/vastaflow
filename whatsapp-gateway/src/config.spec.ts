import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig, type EnvReader } from './config.js';

/** Token FICTICIO no formato exigido (prefixo + 43 caracteres base64url). */
const TOKEN = `vfs_${'A'.repeat(43)}`;
const BASE: EnvReader = {
  GATEWAY_BACKEND_URL: 'http://backend:3000',
  GATEWAY_SERVICE_TOKEN_FILE: '/run/secrets/token',
  GATEWAY_ACCOUNT: '5511900000000',
};
const files =
  (conteudo: string) =>
  (path: string): string => {
    if (path !== '/run/secrets/token') throw new Error('nao existe');
    return conteudo;
  };

const problemas = (env: EnvReader, read = files(`${TOKEN}\n`)): string[] => {
  try {
    loadConfig(env, read);
    return [];
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return [...error.problems];
  }
};

describe('loadConfig', () => {
  it('configuracao valida: token do arquivo (sem a quebra de linha) e padroes seguros', () => {
    const config = loadConfig(BASE, files(`${TOKEN}\n`));

    assert.deepEqual(config, {
      backendUrl: 'http://backend:3000',
      serviceToken: TOKEN,
      account: '5511900000000',
      ingestTimeoutMs: 10_000,
      sendTimeoutMs: 15_000,
      maxRepliesPerMinute: 20,
      maxQueue: 100,
    });
  });

  it('o token pode vir de variavel (so desenvolvimento), mas o arquivo tem precedencia', () => {
    const outro = `vfs_${'B'.repeat(43)}`;

    assert.equal(
      loadConfig(
        { ...BASE, GATEWAY_SERVICE_TOKEN_FILE: undefined, GATEWAY_SERVICE_TOKEN: outro },
        files(''),
      ).serviceToken,
      outro,
    );
    assert.equal(
      loadConfig({ ...BASE, GATEWAY_SERVICE_TOKEN: outro }, files(TOKEN)).serviceToken,
      TOKEN,
    );
  });

  for (const [nome, over, esperado] of [
    ['sem URL do backend', { GATEWAY_BACKEND_URL: undefined }, /GATEWAY_BACKEND_URL ausente/],
    ['URL invalida', { GATEWAY_BACKEND_URL: 'nao e url' }, /nao e uma URL valida/],
    [
      'URL com usuario e senha',
      { GATEWAY_BACKEND_URL: 'http://u:p@backend:3000' },
      /usuario ou senha/,
    ],
    ['URL com caminho', { GATEWAY_BACKEND_URL: 'http://backend:3000/api' }, /so a origem/],
    ['URL com query', { GATEWAY_BACKEND_URL: 'http://backend:3000/?x=1' }, /so a origem/],
    [
      'http em host publico',
      { GATEWAY_BACKEND_URL: 'http://api.exemplo.com' },
      /https, ou http apenas para a rede interna/,
    ],
    [
      'http em IP publico',
      { GATEWAY_BACKEND_URL: 'http://203.0.113.10:3000' },
      /https, ou http apenas/,
    ],
    ['sem credencial', { GATEWAY_SERVICE_TOKEN_FILE: undefined }, /credencial de servico ausente/],
    ['conta com letras', { GATEWAY_ACCOUNT: '55abc' }, /GATEWAY_ACCOUNT/],
    ['conta curta', { GATEWAY_ACCOUNT: '1234' }, /GATEWAY_ACCOUNT/],
    ['conta ausente', { GATEWAY_ACCOUNT: undefined }, /GATEWAY_ACCOUNT/],
    ['timeout fora da faixa', { GATEWAY_INGEST_TIMEOUT_MS: '5' }, /GATEWAY_INGEST_TIMEOUT_MS/],
    [
      'limite de respostas invalido',
      { GATEWAY_MAX_REPLIES_PER_MINUTE: 'muitas' },
      /GATEWAY_MAX_REPLIES_PER_MINUTE/,
    ],
    ['fila fora da faixa', { GATEWAY_MAX_QUEUE: '0' }, /GATEWAY_MAX_QUEUE/],
  ] as const) {
    it(`recusa: ${nome}`, () => {
      assert.match(problemas({ ...BASE, ...over }).join('|'), esperado);
    });
  }

  it('aceita https em qualquer host e http em loopback', () => {
    for (const url of [
      'https://vastaflow.exemplo.com',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://backend',
    ]) {
      assert.deepEqual(problemas({ ...BASE, GATEWAY_BACKEND_URL: url }), []);
    }
  });

  it('arquivo de credencial ilegivel ou com formato invalido', () => {
    assert.match(
      problemas(BASE, () => {
        throw new Error('x');
      }).join('|'),
      /ilegivel/,
    );
    assert.match(problemas(BASE, files('qualquer-coisa')).join('|'), /formato invalido/);
    assert.match(problemas(BASE, files('')).join('|'), /ausente/);
  });

  it('lista TODOS os problemas de uma vez e NUNCA repete valores (token, URL, conta)', () => {
    const segredo = 'vfs_SEGREDO-CURTO';
    const lista = problemas(
      {
        GATEWAY_BACKEND_URL: 'http://u:senha-secreta@api.exemplo.com',
        GATEWAY_SERVICE_TOKEN: segredo,
        GATEWAY_ACCOUNT: 'conta-errada',
      },
      files(''),
    );

    assert.ok(lista.length >= 3);
    const texto = lista.join('|');
    for (const proibido of ['senha-secreta', 'SEGREDO-CURTO', 'api.exemplo.com', 'conta-errada']) {
      assert.ok(!texto.includes(proibido), `vazou: ${proibido}`);
    }
  });
});
