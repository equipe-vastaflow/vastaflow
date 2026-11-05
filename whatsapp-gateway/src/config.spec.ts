import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig, type EnvReader } from './config.js';

/** Segredos 100% FICTICIOS, gerados no proprio teste. */
const TOKEN = `vfs_${'A'.repeat(43)}`;
const KEY = randomBytes(32);
const DB_PASSWORD = 'senha-do-banco-ficticia-123';

const FILES: Record<string, string> = {
  '/run/secrets/token': `${TOKEN}\n`,
  '/run/secrets/dbpass': `${DB_PASSWORD}\n`,
  '/run/secrets/authkey': `${KEY.toString('base64')}\n`,
};
const read = (path: string): string => {
  const content = FILES[path];
  if (content === undefined) throw new Error('nao existe');
  return content;
};

const BASE: EnvReader = {
  GATEWAY_BACKEND_URL: 'http://backend:3000',
  GATEWAY_SERVICE_TOKEN_FILE: '/run/secrets/token',
  GATEWAY_ACCOUNT: '5511900000000',
  GATEWAY_DB_HOST: 'mysql',
  GATEWAY_DB_NAME: 'vastaflow',
  GATEWAY_DB_USER: 'whatsapp_gateway',
  GATEWAY_DB_PASSWORD_FILE: '/run/secrets/dbpass',
  GATEWAY_AUTH_ENCRYPTION_KEY_FILE: '/run/secrets/authkey',
};

const problemas = (env: EnvReader, reader = read): string[] => {
  try {
    loadConfig(env, reader);
    return [];
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return [...error.problems];
  }
};

describe('loadConfig', () => {
  it('configuracao valida: segredos dos arquivos (sem quebra de linha) e padroes seguros', () => {
    const config = loadConfig(BASE, read);

    assert.equal(config.serviceToken, TOKEN);
    assert.deepEqual(config.encryptionKey, KEY);
    assert.deepEqual(config.db, {
      host: 'mysql',
      port: 3306,
      database: 'vastaflow',
      user: 'whatsapp_gateway',
      password: DB_PASSWORD,
    });
    assert.equal(config.backendUrl, 'http://backend:3000');
    assert.equal(config.account, '5511900000000');
    assert.equal(config.sessionId, 'principal');
    assert.equal(config.connectEnabled, false, 'conectar e DESLIGADO por padrao');
    assert.equal(config.ingestTimeoutMs, 10_000);
    assert.equal(config.sendTimeoutMs, 15_000);
    assert.equal(config.maxRepliesPerMinute, 20);
    assert.equal(config.maxQueue, 100);
  });

  it('segredos podem vir de variavel (so desenvolvimento), mas o arquivo tem precedencia', () => {
    const outroToken = `vfs_${'B'.repeat(43)}`;
    const semArquivos: EnvReader = {
      ...BASE,
      GATEWAY_SERVICE_TOKEN_FILE: undefined,
      GATEWAY_DB_PASSWORD_FILE: undefined,
      GATEWAY_AUTH_ENCRYPTION_KEY_FILE: undefined,
      GATEWAY_SERVICE_TOKEN: outroToken,
      GATEWAY_DB_PASSWORD: 'outra-senha',
      GATEWAY_AUTH_ENCRYPTION_KEY: KEY.toString('hex'),
    };

    const config = loadConfig(semArquivos, read);
    assert.equal(config.serviceToken, outroToken);
    assert.equal(config.db.password, 'outra-senha');
    assert.deepEqual(config.encryptionKey, KEY);

    assert.equal(
      loadConfig({ ...BASE, GATEWAY_SERVICE_TOKEN: outroToken }, read).serviceToken,
      TOKEN,
    );
  });

  it('GATEWAY_CONNECT_ENABLED: so "true" liga; vazio/false desligam; outro valor e recusado', () => {
    assert.equal(
      loadConfig({ ...BASE, GATEWAY_CONNECT_ENABLED: 'true' }, read).connectEnabled,
      true,
    );
    assert.equal(
      loadConfig({ ...BASE, GATEWAY_CONNECT_ENABLED: 'false' }, read).connectEnabled,
      false,
    );
    assert.equal(loadConfig({ ...BASE, GATEWAY_CONNECT_ENABLED: '' }, read).connectEnabled, false);
    for (const ruim of ['1', 'TRUE', 'sim', 'yes']) {
      assert.match(
        problemas({ ...BASE, GATEWAY_CONNECT_ENABLED: ruim }).join('|'),
        /GATEWAY_CONNECT_ENABLED/,
      );
    }
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
    [
      'sem credencial de servico',
      { GATEWAY_SERVICE_TOKEN_FILE: undefined },
      /credencial de servico ausente/,
    ],
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
    ['sessao com maiusculas', { GATEWAY_SESSION_ID: 'Principal' }, /GATEWAY_SESSION_ID/],
    ['sessao com espaco', { GATEWAY_SESSION_ID: 'a b' }, /GATEWAY_SESSION_ID/],
    ['banco sem host', { GATEWAY_DB_HOST: undefined }, /GATEWAY_DB_HOST/],
    [
      'host do banco com caracteres estranhos',
      { GATEWAY_DB_HOST: 'mysql;drop' },
      /GATEWAY_DB_HOST/,
    ],
    ['banco sem nome', { GATEWAY_DB_NAME: undefined }, /GATEWAY_DB_NAME/],
    ['nome do banco invalido', { GATEWAY_DB_NAME: 'a-b' }, /GATEWAY_DB_NAME/],
    ['banco sem usuario', { GATEWAY_DB_USER: undefined }, /GATEWAY_DB_USER/],
    ['porta do banco invalida', { GATEWAY_DB_PORT: '70000' }, /GATEWAY_DB_PORT/],
    ['sem senha do banco', { GATEWAY_DB_PASSWORD_FILE: undefined }, /senha do banco ausente/],
    [
      'SEM chave de cifra (nao ha padrao)',
      { GATEWAY_AUTH_ENCRYPTION_KEY_FILE: undefined },
      /chave de cifra da sessao ausente/,
    ],
  ] as const) {
    it(`recusa: ${nome}`, () => {
      assert.match(problemas({ ...BASE, ...over }).join('|'), esperado);
    });
  }

  it('chave de cifra: formato e forca sao conferidos (tamanho, texto simples, repeticao)', () => {
    for (const ruim of [
      'curta',
      randomBytes(16).toString('base64'),
      Buffer.alloc(32, 0).toString('base64'),
      Buffer.alloc(32, 7).toString('hex'),
      'a'.repeat(64),
      'frase-secreta-longa-mas-nao-e-chave-de-32-bytes',
    ]) {
      const lista = problemas(
        { ...BASE, GATEWAY_AUTH_ENCRYPTION_KEY_FILE: undefined, GATEWAY_AUTH_ENCRYPTION_KEY: ruim },
        read,
      );
      assert.match(lista.join('|'), /chave de cifra da sessao invalida/, ruim);
    }
  });

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

  it('arquivo de segredo ilegivel, vazio ou com formato invalido', () => {
    assert.match(
      problemas(BASE, () => {
        throw new Error('x');
      }).join('|'),
      /ilegivel/,
    );
    assert.match(
      problemas(BASE, (p) => (p === '/run/secrets/token' ? 'qualquer-coisa' : read(p))).join('|'),
      /formato invalido/,
    );
    assert.match(
      problemas(BASE, (p) => (p === '/run/secrets/token' ? '' : read(p))).join('|'),
      /ausente/,
    );
    assert.match(
      problemas(BASE, (p) => (p === '/run/secrets/authkey' ? '   \n' : read(p))).join('|'),
      /chave de cifra da sessao ausente/,
    );
  });

  it('lista TODOS os problemas de uma vez e NUNCA repete valores (token, senha, chave, URL, conta)', () => {
    const segredos = {
      token: 'vfs_SEGREDO-CURTO',
      senha: 'senha-secreta-do-banco',
      chave: 'chave-secreta-curta',
      url: 'http://u:senha-na-url@api.exemplo.com',
      conta: 'conta-errada',
      host: 'host;secreto',
    };
    const lista = problemas(
      {
        GATEWAY_BACKEND_URL: segredos.url,
        GATEWAY_SERVICE_TOKEN: segredos.token,
        GATEWAY_ACCOUNT: segredos.conta,
        GATEWAY_DB_HOST: segredos.host,
        GATEWAY_DB_NAME: 'vastaflow',
        GATEWAY_DB_USER: 'u',
        GATEWAY_DB_PASSWORD: segredos.senha,
        GATEWAY_AUTH_ENCRYPTION_KEY: segredos.chave,
      },
      () => '',
    );

    assert.ok(lista.length >= 5);
    const texto = lista.join('|');
    for (const proibido of [
      'SEGREDO-CURTO',
      'senha-secreta',
      'chave-secreta',
      'senha-na-url',
      'api.exemplo.com',
      'conta-errada',
      'host;secreto',
    ]) {
      assert.ok(!texto.includes(proibido), `vazou: ${proibido}`);
    }
  });
});
