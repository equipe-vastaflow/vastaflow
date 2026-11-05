import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  DisconnectReason,
  initAuthCreds,
  jidDecode,
  makeCacheableSignalKeyStore,
  proto,
  type SignalKeyStore,
} from '@whiskeysockets/baileys';
import { DISCONNECT } from './constants.js';
import { createBaileysSocketFactory } from './baileys-socket.js';
import { baileysAuthCodec } from './baileys-auth-codec.js';
import { EncryptedSessionStore } from './encrypted-session-store.js';
import { parseJid } from './message-filter.js';
import type { SessionHandle } from './ports.js';
import { KEY_BYTES, SessionCipher } from './session-crypto.js';
import { FakeScheduler } from './testing/fakes.js';
import { MemoryDatabase, MemorySessionRepository } from './testing/memory-repository.js';

/** Chave FICTICIA gerada no proprio teste. */
const KEY = randomBytes(KEY_BYTES);

/**
 * Contrato com a versao INSTALADA do Baileys. Roda sem conexao e sem conta: so importa a biblioteca e compara.
 * Se uma atualizacao mudar um codigo ou o formato de JID, estes testes quebram ANTES de qualquer reconexao errada.
 */
describe('Baileys instalado', () => {
  it('a versao e EXATA no package.json (sem ^, ~ ou intervalo) e e a 7.0.0-rc14 validada', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    assert.equal(pkg.dependencies['@whiskeysockets/baileys'], '7.0.0-rc14');
    for (const [nome, versao] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.match(versao, /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/, `${nome} nao e exata`);
    }
  });

  it('os codigos de DisconnectReason usados na politica sao IGUAIS aos da biblioteca', () => {
    for (const nome of Object.keys(DISCONNECT) as (keyof typeof DISCONNECT)[]) {
      assert.equal(DISCONNECT[nome], DisconnectReason[nome], nome);
    }
  });

  it('o parser de JID do nucleo concorda com o da biblioteca (telefone, LID, grupo, dispositivo)', () => {
    for (const jid of [
      '5511999990000@s.whatsapp.net',
      '5511999990000:12@s.whatsapp.net',
      '123456789012345@lid',
      '120363000000000000@g.us',
      'status@broadcast',
    ]) {
      const biblioteca = jidDecode(jid);
      const nucleo = parseJid(jid);
      assert.equal(nucleo?.user, biblioteca?.user, jid);
      assert.equal(nucleo?.server, biblioteca?.server, jid);
    }
  });

  it('o adaptador recusa um estado de sessao invalido ANTES de qualquer conexao', () => {
    const factory = createBaileysSocketFactory();

    for (const state of [null, undefined, {}, { creds: {} }, 'x']) {
      assert.throws(
        () => factory({ state, save: () => Promise.resolve() }),
        /estado de sessao invalido/,
      );
    }
  });
});

describe('estado de autenticacao REAL do Baileys pelo armazenamento cifrado (sem conexao, dados ficticios)', () => {
  const sessionId = 'principal';
  const abrir = async (
    db: MemoryDatabase,
  ): Promise<{ store: EncryptedSessionStore; handle: SessionHandle }> => {
    const store = new EncryptedSessionStore({
      repository: new MemorySessionRepository(db),
      cipher: new SessionCipher(KEY),
      codec: baileysAuthCodec,
      scheduler: new FakeScheduler(),
      sessionId,
      owner: randomBytes(8).toString('hex'),
    });
    return { store, handle: await store.open() };
  };

  it('credenciais de initAuthCreds() e chaves de todos os tipos voltam IDENTICAS apos reiniciar, e nada fica em claro', async () => {
    const db = new MemoryDatabase();
    const { store, handle } = await abrir(db);
    const state = handle.state as {
      creds: ReturnType<typeof initAuthCreds>;
      keys: {
        get(t: string, ids: string[]): Promise<Record<string, unknown>>;
        set(d: object): Promise<void>;
      };
    };
    const original = {
      noisePrivate: Buffer.from(state.creds.noiseKey.private),
      identityPrivate: Buffer.from(state.creds.signedIdentityKey.private),
      adv: state.creds.advSecretKey,
      registrationId: state.creds.registrationId,
    };
    const sessionBytes = randomBytes(40);
    const senderKeyBytes = randomBytes(24);
    const syncKeyData = randomBytes(32);
    await state.keys.set({
      'pre-key': { '12': { private: randomBytes(32), public: randomBytes(32) } },
      session: { 'pessoa.0': new Uint8Array(sessionBytes) },
      'sender-key': { grupo: new Uint8Array(senderKeyBytes) },
      'app-state-sync-key': { AAAA: { keyData: syncKeyData, timestamp: 123 } },
      'lid-mapping': { '111': '222@lid' },
    });
    state.creds.registered = true;
    await handle.save();
    await store.close();

    const bruto = [...db.items.values()]
      .map((b) => b.toString('latin1') + b.toString('base64') + b.toString('hex'))
      .join('|');
    for (const segredo of [
      original.noisePrivate,
      original.identityPrivate,
      sessionBytes,
      syncKeyData,
    ]) {
      assert.ok(!bruto.includes(segredo.toString('latin1')), 'bytes em claro');
      assert.ok(!bruto.includes(segredo.toString('base64')), 'base64 em claro');
      assert.ok(!bruto.includes(segredo.toString('hex')), 'hex em claro');
    }
    assert.ok(!bruto.includes(original.adv), 'segredo ADV em claro');

    const { handle: reaberto } = await abrir(db);
    const novo = reaberto.state as typeof state;
    assert.deepEqual(Buffer.from(novo.creds.noiseKey.private), original.noisePrivate);
    assert.deepEqual(Buffer.from(novo.creds.signedIdentityKey.private), original.identityPrivate);
    assert.equal(novo.creds.advSecretKey, original.adv);
    assert.equal(novo.creds.registrationId, original.registrationId);
    assert.equal(novo.creds.registered, true);
    assert.ok(
      Buffer.isBuffer(novo.creds.noiseKey.private),
      'volta como Buffer, nao como objeto JSON',
    );

    assert.deepEqual(
      Buffer.from((await novo.keys.get('session', ['pessoa.0']))['pessoa.0'] as Uint8Array),
      sessionBytes,
    );
    assert.deepEqual(
      Buffer.from((await novo.keys.get('sender-key', ['grupo']))['grupo'] as Uint8Array),
      senderKeyBytes,
    );
    assert.equal((await novo.keys.get('lid-mapping', ['111']))['111'], '222@lid');
    const preKey = (await novo.keys.get('pre-key', ['12']))['12'] as { private: Buffer };
    assert.equal(preKey.private.length, 32);
    const sync = (await novo.keys.get('app-state-sync-key', ['AAAA']))['AAAA'];
    assert.ok(
      sync instanceof proto.Message.AppStateSyncKeyData,
      'app-state-sync-key volta como mensagem protobuf',
    );
    assert.deepEqual(Buffer.from((sync as { keyData: Uint8Array }).keyData), syncKeyData);
  });

  it('o armazenamento serve de SignalKeyStore para makeCacheableSignalKeyStore (como no socket real)', async () => {
    const db = new MemoryDatabase();
    const { handle } = await abrir(db);
    const { keys } = handle.state as { keys: SignalKeyStore };
    const cache = makeCacheableSignalKeyStore(keys);

    await cache.set({ 'pre-key': { '1': { private: randomBytes(32), public: randomBytes(32) } } });
    const lida = await cache.get('pre-key', ['1', '2']);

    assert.deepEqual(Object.keys(lida), ['1']);
    assert.equal(db.items.size, 2, 'creds + 1 chave, ambas cifradas');
  });
});
