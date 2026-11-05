import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, it } from 'node:test';
import {
  KEY_BYTES,
  MAX_PLAINTEXT_BYTES,
  parseEncryptionKey,
  SessionCipher,
  SessionDecryptError,
  type ItemContext,
} from './session-crypto.js';

/** Chaves e dados 100% FICTICIOS, gerados no proprio teste. */
const KEY = randomBytes(KEY_BYTES);
const OTHER_KEY = randomBytes(KEY_BYTES);
const CTX: ItemContext = { sessionId: 'principal', type: 'pre-key', id: '7' };
const PLAIN = '{"private":"SEGREDO-FICTICIO-CHAVE-PRIVADA","n":1}';

describe('parseEncryptionKey', () => {
  it('aceita 32 bytes em base64 (com e sem padding) e 64 caracteres hexadecimais', () => {
    for (const texto of [
      KEY.toString('base64'),
      KEY.toString('base64').replace(/=+$/, ''),
      KEY.toString('hex'),
      KEY.toString('hex').toUpperCase(),
      `  ${KEY.toString('base64')}\n`,
    ]) {
      const parsed = parseEncryptionKey(texto);
      assert.ok(parsed !== null, texto);
      assert.deepEqual(parsed, KEY);
    }
  });

  it('recusa tamanho errado, formato invalido e vazio', () => {
    for (const texto of [
      '',
      'curta',
      randomBytes(16).toString('base64'),
      randomBytes(31).toString('hex'),
      randomBytes(33).toString('base64'),
      `${KEY.toString('hex')}00`,
      'z'.repeat(64),
      `${KEY.toString('base64')}!`,
    ]) {
      assert.equal(parseEncryptionKey(texto), null, texto);
    }
  });

  it('recusa chaves obviamente fracas (zeros, repeticao, poucos bytes distintos)', () => {
    for (const fraca of [
      Buffer.alloc(32, 0),
      Buffer.alloc(32, 0xff),
      Buffer.alloc(32, 0x41),
      Buffer.from('0123456701234567012345670123456701234567012345670123456701234567'.slice(0, 32)),
    ]) {
      assert.equal(parseEncryptionKey(fraca.toString('base64')), null);
      assert.equal(parseEncryptionKey(fraca.toString('hex')), null);
    }
  });
});

describe('SessionCipher (AES-256-GCM)', () => {
  const cipher = new SessionCipher(KEY);

  it('ida e volta; o envelope e binario, versionado e NAO contem o texto em claro', () => {
    const envelope = cipher.encrypt(PLAIN, CTX);

    assert.equal(envelope[0], 1);
    assert.equal(envelope.length, 1 + 12 + Buffer.byteLength(PLAIN) + 16);
    assert.equal(cipher.decrypt(envelope, CTX), PLAIN);
    for (const forma of [
      PLAIN,
      'SEGREDO-FICTICIO',
      Buffer.from(PLAIN).toString('base64').slice(0, 20),
    ]) {
      assert.ok(!envelope.toString('latin1').includes(forma));
      assert.ok(!envelope.toString('base64').includes(forma));
      assert.ok(!envelope.toString('hex').includes(Buffer.from(forma).toString('hex')));
    }
  });

  it('o nonce e aleatorio a cada gravacao: o mesmo texto nunca gera o mesmo envelope', () => {
    const nonces = new Set<string>();
    const envelopes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const envelope = cipher.encrypt(PLAIN, CTX);
      nonces.add(envelope.subarray(1, 13).toString('hex'));
      envelopes.add(envelope.toString('hex'));
    }

    assert.equal(nonces.size, 200);
    assert.equal(envelopes.size, 200);
  });

  it('usa o gerador injetado com 12 bytes de nonce', () => {
    const tamanhos: number[] = [];
    const c = new SessionCipher(KEY, (n) => {
      tamanhos.push(n);
      return randomBytes(n);
    });

    c.encrypt('x', CTX);

    assert.deepEqual(tamanhos, [12]);
  });

  it('chave ERRADA nao decifra (erro fixo, sem pistas)', () => {
    const envelope = cipher.encrypt(PLAIN, CTX);

    assert.throws(
      () => new SessionCipher(OTHER_KEY).decrypt(envelope, CTX),
      (e: unknown) => e instanceof SessionDecryptError,
    );
  });

  it('qualquer adulteracao falha: versao, nonce, conteudo, tag, truncamento e envelope vazio', () => {
    const envelope = cipher.encrypt(PLAIN, CTX);
    const mutar = (indice: number): Buffer => {
      const copia = Buffer.from(envelope);
      copia[indice] = (copia[indice] ?? 0) ^ 0x01;
      return copia;
    };

    const adulterados = [
      mutar(0),
      mutar(1),
      mutar(13),
      mutar(envelope.length - 1),
      envelope.subarray(0, envelope.length - 1),
      envelope.subarray(0, 20),
      Buffer.alloc(0),
      Buffer.alloc(28),
      Buffer.concat([envelope, Buffer.from([0])]),
    ];
    for (const ruim of adulterados) {
      assert.throws(() => cipher.decrypt(ruim, CTX), SessionDecryptError);
    }
  });

  it('o CONTEXTO e autenticado: a mesma linha em outra sessao, tipo ou id nao decifra', () => {
    const envelope = cipher.encrypt(PLAIN, CTX);

    for (const outro of [
      { ...CTX, sessionId: 'outra' },
      { ...CTX, type: 'session' },
      { ...CTX, id: '8' },
    ]) {
      assert.throws(() => cipher.decrypt(envelope, outro), SessionDecryptError);
    }
    assert.equal(cipher.decrypt(envelope, CTX), PLAIN);
  });

  it('o erro de decifrar nao traz chave, texto nem contexto', () => {
    const envelope = cipher.encrypt(PLAIN, CTX);
    let erro: Error | null = null;
    try {
      new SessionCipher(OTHER_KEY).decrypt(envelope, CTX);
    } catch (e) {
      erro = e as Error;
    }

    assert.ok(erro !== null);
    const exposto = `${erro.message} ${erro.stack ?? ''} ${JSON.stringify(erro)}`;
    for (const proibido of [
      KEY.toString('hex'),
      KEY.toString('base64'),
      OTHER_KEY.toString('hex'),
      OTHER_KEY.toString('base64'),
      'SEGREDO',
      CTX.sessionId,
    ]) {
      assert.ok(!exposto.includes(proibido), `vazou: ${proibido}`);
    }
  });

  it('a chave nao aparece em JSON, inspect nem propriedades do objeto', () => {
    const exposto = [
      JSON.stringify(cipher),
      inspect(cipher, { showHidden: true, depth: 5 }),
      Object.keys(cipher).join(','),
      String(Object.getOwnPropertyNames(cipher)),
    ].join('|');

    assert.ok(!exposto.includes(KEY.toString('hex')));
    assert.ok(!exposto.includes(KEY.toString('base64')));
  });

  it('copia a chave: alterar o Buffer original depois nao muda a cifra', () => {
    const original = Buffer.from(KEY);
    const c = new SessionCipher(original);
    const envelope = c.encrypt(PLAIN, CTX);

    original.fill(0);

    assert.equal(c.decrypt(envelope, CTX), PLAIN);
  });

  it('recusa chave de tamanho errado e item grande demais', () => {
    assert.throws(() => new SessionCipher(Buffer.alloc(16)), /chave de cifra invalida/);
    assert.throws(() => cipher.encrypt('x'.repeat(MAX_PLAINTEXT_BYTES + 1), CTX), /grande demais/);
  });

  it('suporta texto Unicode', () => {
    const texto = 'ação — 日本語 — 🔐';

    assert.equal(cipher.decrypt(cipher.encrypt(texto, CTX), CTX), texto);
  });
});
