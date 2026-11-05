import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { EncryptedSessionStore } from './encrypted-session-store.js';
import { SessionUnavailableError, type SessionHandle } from './ports.js';
import type { StopReason } from './reconnect-policy.js';
import { KEY_BYTES, SessionCipher } from './session-crypto.js';
import { FakeScheduler, flush } from './testing/fakes.js';
import {
  fakeCodec,
  MemoryDatabase,
  MemorySessionRepository,
  SECRET_MARKER,
} from './testing/memory-repository.js';

/** Tudo FICTICIO: chaves geradas aqui, "banco" em memoria, nenhuma conta. */
const KEY = randomBytes(KEY_BYTES);
const SESSION = 'principal';
const TTL = 30_000;

interface Keys {
  get(type: string, ids: string[]): Promise<Record<string, unknown>>;
  set(data: Record<string, Record<string, unknown> | undefined>): Promise<void>;
}
interface State {
  creds: Record<string, unknown> & { registered: boolean; marker?: number };
  keys: Keys;
}
const stateOf = (handle: SessionHandle): State => handle.state as State;

// Helper de teste: o tipo de retorno e o da propria montagem (inferido).
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function montar(
  options: { db?: MemoryDatabase; key?: Buffer; owner?: string; sessionId?: string } = {},
) {
  const db = options.db ?? new MemoryDatabase();
  const repo = new MemorySessionRepository(db);
  const scheduler = new FakeScheduler();
  const fatals: StopReason[] = [];
  const store = new EncryptedSessionStore({
    repository: repo,
    cipher: new SessionCipher(options.key ?? KEY),
    codec: fakeCodec,
    scheduler,
    sessionId: options.sessionId ?? SESSION,
    owner: options.owner ?? randomBytes(8).toString('hex'),
    leaseTtlMs: TTL,
    renewEveryMs: 10_000,
  });
  store.onFatal((reason) => fatals.push(reason));
  return { db, repo, scheduler, store, fatals };
}

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SessionUnavailableError, `erro inesperado: ${String(error)}`);
    return error.reason;
  }
  throw new assert.AssertionError({ message: 'deveria falhar' });
};

const stored = (db: MemoryDatabase): Buffer[] => [...db.items.values()];
const noPlaintext = (db: MemoryDatabase): boolean =>
  stored(db).every((b) => {
    const forms = [SECRET_MARKER, Buffer.from(SECRET_MARKER).toString('base64').slice(0, 24)];
    return forms.every(
      (f) => !b.toString('latin1').includes(f) && !b.toString('base64').includes(f),
    );
  });

describe('EncryptedSessionStore - persistencia e cifra', () => {
  it('sessao nova: cria credenciais, grava CIFRADO e nada fica em texto puro no banco', async () => {
    const m = montar();

    const handle = await m.store.open();

    assert.equal(stateOf(handle).creds.registered, false);
    assert.equal(m.db.items.size, 1);
    assert.ok(m.repo.raw(SESSION, 'creds', '-') !== undefined);
    assert.ok(noPlaintext(m.db), 'credencial em claro no banco');
  });

  it('chaves Signal tambem so existem cifradas', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());

    await keys.set({
      'pre-key': {
        '1': { private: Buffer.from(`${SECRET_MARKER}-pre`), public: Buffer.from('p') },
      },
      session: { 'fulano.0': Buffer.from(`${SECRET_MARKER}-session`) },
    });

    assert.equal(m.db.items.size, 3);
    assert.ok(noPlaintext(m.db), 'chave em claro no banco');
  });

  it('SOBREVIVE A REINICIALIZACAO: outra instancia (mesmo banco e chave) le o mesmo estado', async () => {
    const a = montar();
    const handleA = await a.store.open();
    const stateA = stateOf(handleA);
    stateA.creds.registered = true;
    stateA.creds.marker = 99;
    await handleA.save();
    await stateA.keys.set({
      'pre-key': { '5': { private: Buffer.from('k5'), public: Buffer.from('p5') } },
      'sender-key': { grupo: Buffer.from('sk') },
    });
    await a.store.close(); // "o processo terminou"

    const b = montar({ db: a.db });
    const stateB = stateOf(await b.store.open());
    const lidas = await stateB.keys.get('pre-key', ['5', '6']);

    assert.deepEqual(Object.keys(lidas), ['5']);
    assert.deepEqual((lidas['5'] as { private: Buffer }).private, Buffer.from('k5'));
    assert.deepEqual((await stateB.keys.get('sender-key', ['grupo']))['grupo'], Buffer.from('sk'));
    assert.equal(stateB.creds.registered, true);
    assert.equal(stateB.creds.marker, 99);
  });

  it('creds.update (save) persiste as credenciais MAIS RECENTES e elas voltam apos reiniciar', async () => {
    const a = montar();
    const handle = await a.store.open();
    const state = stateOf(handle);
    state.creds.registered = true;
    state.creds.marker = 7;
    await handle.save();
    await a.store.close();

    const b = montar({ db: a.db });
    const reaberto = stateOf(await b.store.open());

    assert.equal(reaberto.creds.registered, true);
    assert.equal(reaberto.creds.marker, 7);
    assert.deepEqual(
      (reaberto.creds.noiseKey as { private: Buffer }).private,
      Buffer.from(`${SECRET_MARKER}-noise`),
    );
    assert.ok(noPlaintext(a.db));
  });

  it('chaves apagadas (valor nulo) somem; as demais ficam', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());
    await keys.set({ 'pre-key': { '1': { a: 1 }, '2': { a: 2 }, '3': { a: 3 } } });

    await keys.set({ 'pre-key': { '2': undefined } });
    await keys.set({ 'pre-key': { '3': null as unknown as undefined } });

    assert.deepEqual(Object.keys(await keys.get('pre-key', ['1', '2', '3'])), ['1']);
  });

  it('lote vazio nao grava nada', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());
    const antes = m.repo.writes;

    await keys.set({});
    await keys.set({ 'pre-key': {} });
    await keys.get('pre-key', []);

    assert.equal(m.repo.writes, antes);
  });

  it('abrir de novo (reconexao) e idempotente e relê o estado do banco', async () => {
    const m = montar();
    await m.store.open();

    const handle = await m.store.open();

    assert.equal(stateOf(handle).creds.registered, false);
    assert.equal(m.db.items.size, 1);
  });
});

describe('EncryptedSessionStore - concorrencia', () => {
  it('muitas escritas simultaneas de chaves: nenhuma se perde', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());

    await Promise.all(
      Array.from({ length: 60 }, (_v, i) => keys.set({ 'pre-key': { [String(i)]: { n: i } } })),
    );

    const todas = await keys.get(
      'pre-key',
      Array.from({ length: 60 }, (_v, i) => String(i)),
    );
    assert.equal(Object.keys(todas).length, 60);
    assert.equal((todas['59'] as { n: number }).n, 59);
  });

  it('o MESMO id escrito varias vezes ao mesmo tempo termina com o ULTIMO valor (ordem preservada)', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());

    await Promise.all(
      Array.from({ length: 25 }, (_v, i) => keys.set({ 'pre-key': { '1': { versao: i } } })),
    );

    assert.equal(((await keys.get('pre-key', ['1']))['1'] as { versao: number }).versao, 24);
  });

  it('escrita e apagamento intercalados respeitam a ordem de chegada', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());

    await Promise.all([
      keys.set({ 'pre-key': { '1': { v: 1 } } }),
      keys.set({ 'pre-key': { '1': undefined } }),
      keys.set({ 'pre-key': { '1': { v: 3 } } }),
      keys.set({ 'pre-key': { '2': { v: 1 } } }),
      keys.set({ 'pre-key': { '2': undefined } }),
    ]);

    const lidas = await keys.get('pre-key', ['1', '2']);
    assert.deepEqual(Object.keys(lidas), ['1']);
    assert.equal((lidas['1'] as { v: number }).v, 3);
  });

  it('muitos creds.update seguidos sao JUNTADOS e o ultimo estado e o que fica gravado', async () => {
    const m = montar();
    const handle = await m.store.open();
    const state = stateOf(handle);
    const antes = m.repo.writes;

    const pedidos: Promise<void>[] = [];
    for (let i = 1; i <= 30; i += 1) {
      state.creds.marker = i;
      pedidos.push(handle.save());
    }
    await Promise.all(pedidos);

    assert.ok(m.repo.writes - antes <= 3, `gravou ${String(m.repo.writes - antes)} vezes`);
    await m.store.close();
    const reaberto = stateOf(await montar({ db: m.db }).store.open());
    assert.equal(reaberto.creds.marker, 30);
  });

  it('creds.update durante uma gravacao em andamento gera nova gravacao com o estado atual', async () => {
    const m = montar();
    const handle = await m.store.open();
    const state = stateOf(handle);

    state.creds.marker = 1;
    const primeira = handle.save();
    await flush(1);
    state.creds.marker = 2;
    const segunda = handle.save();
    await Promise.all([primeira, segunda]);

    await m.store.close();
    assert.equal(stateOf(await montar({ db: m.db }).store.open()).creds.marker, 2);
  });

  it('creds e chaves intercalados continuam consistentes apos reiniciar', async () => {
    const m = montar();
    const handle = await m.store.open();
    const state = stateOf(handle);

    const todos: Promise<void>[] = [];
    for (let i = 0; i < 20; i += 1) {
      state.creds.marker = i;
      todos.push(
        handle.save(),
        state.keys.set({ session: { [`s${String(i)}`]: Buffer.from([i]) } }),
      );
    }
    await Promise.all(todos);
    await m.store.close();

    const b = stateOf(await montar({ db: m.db }).store.open());
    assert.equal(b.creds.marker, 19);
    assert.equal(
      Object.keys(
        await b.keys.get(
          'session',
          Array.from({ length: 20 }, (_v, i) => `s${String(i)}`),
        ),
      ).length,
      20,
    );
  });
});

describe('EncryptedSessionStore - trava de instancia unica', () => {
  it('segunda instancia com a MESMA sessao nao abre: sessao-em-uso, e nada e tocado', async () => {
    const a = montar();
    await a.store.open();
    const antes = [...a.db.items.entries()].map(([k, v]) => `${k}:${v.toString('hex')}`);
    const b = montar({ db: a.db });

    assert.equal(await reasonOf(b.store.open()), 'sessao-em-uso');

    assert.deepEqual(
      [...a.db.items.entries()].map(([k, v]) => `${k}:${v.toString('hex')}`),
      antes,
    );
    assert.deepEqual(b.fatals, [], 'quem nao conseguiu a trava nao e "fatal": so nao abre');
  });

  it('sessoes DIFERENTES nao se bloqueiam', async () => {
    const a = montar({ sessionId: 'uma' });
    const b = montar({ db: a.db, sessionId: 'outra' });

    await a.store.open();
    await b.store.open();

    assert.equal(a.db.items.size, 2);
  });

  it('close() solta a trava: a outra instancia passa a abrir e enxerga o estado', async () => {
    const a = montar();
    const handle = await a.store.open();
    stateOf(handle).creds.marker = 11;
    await handle.save();
    await a.store.close();

    const b = montar({ db: a.db });

    assert.equal(stateOf(await b.store.open()).creds.marker, 11);
  });

  it('trava expirada (instancia que travou/sumiu) pode ser assumida; o dono antigo NAO consegue mais gravar', async () => {
    const a = montar();
    const stateA = stateOf(await a.store.open());
    const b = montar({ db: a.db });
    a.db.nowMs += TTL + 1; // o banco enxerga a trava de A vencida
    const stateB = stateOf(await b.store.open());
    await stateB.keys.set({ 'pre-key': { '9': { dono: 'B' } } });

    // A ainda acha que e dona e tenta gravar.
    await assert.rejects(
      () => stateA.keys.set({ 'pre-key': { '9': { dono: 'A' } } }),
      /falha ao gravar/,
    );

    assert.deepEqual(a.fatals, ['trava-perdida']);
    assert.equal(((await stateB.keys.get('pre-key', ['9']))['9'] as { dono: string }).dono, 'B');
  });

  it('heartbeat: renova a trava periodicamente e a mantem viva', async () => {
    const m = montar();
    await m.store.open();

    for (let i = 0; i < 5; i += 1) {
      m.db.nowMs += 10_000;
      assert.ok(m.scheduler.runNext());
      await flush(3);
    }

    assert.deepEqual(m.fatals, []);
    const outro = montar({ db: m.db });
    assert.equal(await reasonOf(outro.store.open()), 'sessao-em-uso');
  });

  it('PERDA da trava detectada pelo heartbeat: fatal trava-perdida e o armazenamento fica inutilizavel', async () => {
    const m = montar();
    const state = stateOf(await m.store.open());
    m.db.nowMs += TTL + 1;
    montar({ db: m.db }); // (outra instancia assume em seguida)
    await new MemorySessionRepository(m.db).acquireLease(SESSION, 'intruso', TTL);

    m.scheduler.runNext();
    await flush(3);

    assert.deepEqual(m.fatals, ['trava-perdida']);
    assert.equal(m.store.fatalReason, 'trava-perdida');
    await assert.rejects(() => state.keys.get('pre-key', ['1']), /sessao encerrada/);
    await assert.rejects(() => state.keys.set({ 'pre-key': { '1': { a: 1 } } }), /falha ao gravar/);
    assert.equal(await reasonOf(m.store.open()), 'trava-perdida');
  });

  it('erro TRANSITORIO do banco na renovacao e tolerado; dois seguidos perdem a trava', async () => {
    const m = montar();
    await m.store.open();

    m.repo.failLease = true;
    m.scheduler.runNext();
    await flush(3);
    assert.deepEqual(m.fatals, []);
    m.repo.failLease = false;
    m.scheduler.runNext();
    await flush(3);
    assert.deepEqual(m.fatals, []);

    m.repo.failLease = true;
    m.scheduler.runNext();
    await flush(3);
    m.scheduler.runNext();
    await flush(3);
    assert.deepEqual(m.fatals, ['trava-perdida']);
  });

  it('o fatal e avisado UMA vez e nao se rearma', async () => {
    const m = montar();
    const state = stateOf(await m.store.open());
    m.repo.failNextWrite = true;

    await assert.rejects(() => state.keys.set({ session: { a: Buffer.from('x') } }));
    await assert.rejects(() => state.keys.set({ session: { b: Buffer.from('y') } }));

    assert.deepEqual(m.fatals, ['falha-gravar-sessao']);
    assert.equal(m.scheduler.active, 0, 'heartbeat parado');
  });
});

describe('EncryptedSessionStore - FALHA FECHADA (chave errada, corrupcao, inconsistencia)', () => {
  async function sessaoExistente(): Promise<MemoryDatabase> {
    const m = montar();
    const handle = await m.store.open();
    stateOf(handle).creds.marker = 5;
    await handle.save();
    await stateOf(handle).keys.set({ 'pre-key': { '1': { a: 1 } } });
    await m.store.close();
    return m.db;
  }

  it('CHAVE ERRADA: nao abre (sessao-ilegivel), avisa fatal e NAO sobrescreve nada', async () => {
    const db = await sessaoExistente();
    const antes = [...db.items.entries()].map(([k, v]) => `${k}:${v.toString('hex')}`);
    const errada = montar({ db, key: randomBytes(KEY_BYTES) });

    assert.equal(await reasonOf(errada.store.open()), 'sessao-ilegivel');

    assert.deepEqual(errada.fatals, ['sessao-ilegivel']);
    assert.deepEqual(
      [...db.items.entries()].map(([k, v]) => `${k}:${v.toString('hex')}`),
      antes,
      'banco alterado',
    );
  });

  it('chave errada solta a trava: a instancia com a chave CERTA abre normalmente depois', async () => {
    const db = await sessaoExistente();
    const errada = montar({ db, key: randomBytes(KEY_BYTES) });
    await reasonOf(errada.store.open());

    const certa = montar({ db });

    assert.equal(stateOf(await certa.store.open()).creds.marker, 5);
  });

  it('close() AGUARDA a liberacao da trava disparada pelo erro fatal (o processo nao sai antes dela)', async () => {
    const db = await sessaoExistente();
    const errada = montar({ db, key: randomBytes(KEY_BYTES) });
    errada.repo.releaseDelayMs = 40; // banco lento
    await reasonOf(errada.store.open());

    await errada.store.close();

    // Logo depois do close(), outra instancia ja consegue a trava: nada ficou preso por ate 30 s.
    assert.equal(await new MemorySessionRepository(db).acquireLease(SESSION, 'outro', TTL), true);
  });

  it('depois do erro o armazenamento fica inutilizavel (nunca "tenta de novo" com outra coisa)', async () => {
    const db = await sessaoExistente();
    const errada = montar({ db, key: randomBytes(KEY_BYTES) });
    await reasonOf(errada.store.open());

    assert.equal(await reasonOf(errada.store.open()), 'sessao-ilegivel');
  });

  it('credenciais CORROMPIDAS (um byte alterado): sessao-ilegivel, sem recriar a sessao', async () => {
    const db = await sessaoExistente();
    const chave = MemoryDatabase.key(SESSION, 'creds', '-');
    const envelope = Buffer.from(db.items.get(chave) ?? Buffer.alloc(0));
    envelope[20] = (envelope[20] ?? 0) ^ 0xff;
    db.items.set(chave, envelope);
    const m = montar({ db });

    assert.equal(await reasonOf(m.store.open()), 'sessao-ilegivel');

    assert.deepEqual(
      db.items.get(chave),
      envelope,
      'credenciais nao podem ser regravadas por cima',
    );
  });

  it('credenciais TRUNCADAS ou vazias: sessao-ilegivel', async () => {
    for (const corte of [0, 5, 27]) {
      const db = await sessaoExistente();
      const chave = MemoryDatabase.key(SESSION, 'creds', '-');
      db.items.set(chave, (db.items.get(chave) ?? Buffer.alloc(0)).subarray(0, corte));

      assert.equal(
        await reasonOf(montar({ db }).store.open()),
        'sessao-ilegivel',
        `corte ${String(corte)}`,
      );
    }
  });

  it('linha COPIADA para outro lugar (credenciais no lugar de uma chave) nao decifra', async () => {
    const db = await sessaoExistente();
    db.items.set(
      MemoryDatabase.key(SESSION, 'pre-key', '1'),
      db.items.get(MemoryDatabase.key(SESSION, 'creds', '-')) ?? Buffer.alloc(0),
    );
    const m = montar({ db });
    const state = stateOf(await m.store.open());

    await assert.rejects(() => state.keys.get('pre-key', ['1']));

    assert.deepEqual(m.fatals, ['sessao-ilegivel']);
  });

  it('chave corrompida em tempo de execucao: fatal e todas as leituras seguintes falham', async () => {
    const db = await sessaoExistente();
    const m = montar({ db });
    const state = stateOf(await m.store.open());
    const chave = MemoryDatabase.key(SESSION, 'pre-key', '1');
    const envelope = Buffer.from(db.items.get(chave) ?? Buffer.alloc(0));
    envelope[envelope.length - 1] = (envelope[envelope.length - 1] ?? 0) ^ 1;
    db.items.set(chave, envelope);

    await assert.rejects(() => state.keys.get('pre-key', ['1']));
    await assert.rejects(() => state.keys.get('session', ['x']), /sessao encerrada/);

    assert.deepEqual(m.fatals, ['sessao-ilegivel']);
  });

  it('estado INCONSISTENTE (chaves sem credenciais): recusa em vez de criar credenciais novas por cima', async () => {
    const db = await sessaoExistente();
    db.items.delete(MemoryDatabase.key(SESSION, 'creds', '-'));
    const m = montar({ db });

    assert.equal(await reasonOf(m.store.open()), 'sessao-ilegivel');

    assert.equal(db.items.size, 1, 'nenhuma credencial nova foi criada');
  });

  it('JSON invalido DEPOIS de decifrar tambem e ilegivel', async () => {
    const m = montar();
    await m.store.open();
    await m.store.close();
    const cipher = new SessionCipher(KEY);
    m.db.items.set(
      MemoryDatabase.key(SESSION, 'creds', '-'),
      cipher.encrypt('isto nao e json', { sessionId: SESSION, type: 'creds', id: '-' }),
    );

    assert.equal(await reasonOf(montar({ db: m.db }).store.open()), 'sessao-ilegivel');
  });
});

describe('EncryptedSessionStore - falhas de escrita e de banco', () => {
  it('falha ao gravar chaves: fatal falha-gravar-sessao, mensagem FIXA e NADA parcial no banco', async () => {
    const m = montar();
    const state = stateOf(await m.store.open());
    const antes = m.db.items.size;
    m.repo.failNextWrite = true;

    let erro: Error | null = null;
    try {
      await state.keys.set({
        'pre-key': { '1': { a: 1 }, '2': { a: 2 } },
        session: { s: Buffer.from('x') },
      });
    } catch (e) {
      erro = e as Error;
    }

    assert.ok(erro !== null);
    assert.equal(erro.message, 'falha ao gravar o estado da sessao');
    for (const proibido of ['password', 'segredo', 'user=gw', 'INSERT']) {
      assert.ok(
        !erro.message.includes(proibido) && !(erro.stack ?? '').includes(proibido),
        proibido,
      );
    }
    assert.deepEqual(m.fatals, ['falha-gravar-sessao']);
    assert.equal(m.db.items.size, antes);
  });

  it('falha ao gravar credenciais (creds.update): fatal e o erro nao vaza detalhes', async () => {
    const m = montar();
    const handle = await m.store.open();
    m.repo.failNextWrite = true;

    await assert.rejects(() => handle.save(), /^Error: falha ao gravar o estado da sessao$/);

    assert.deepEqual(m.fatals, ['falha-gravar-sessao']);
  });

  it('falha ao gravar as credenciais INICIAIS: a sessao nao abre', async () => {
    const m = montar();
    m.repo.failNextWrite = true;

    await assert.rejects(() => m.store.open());

    assert.deepEqual(m.fatals, ['falha-gravar-sessao']);
    assert.equal(m.db.items.size, 0);
  });

  it('o save() disparado pelo evento do Baileys (sem await) nunca gera rejeicao nao tratada', async () => {
    const m = montar();
    const handle = await m.store.open();
    m.repo.failNextWrite = true;
    let naoTratada = false;
    const ouvinte = (): void => {
      naoTratada = true;
    };
    process.once('unhandledRejection', ouvinte);

    void handle.save().catch(() => undefined);
    await flush(10);
    process.off('unhandledRejection', ouvinte);

    assert.equal(naoTratada, false);
  });

  it('banco fora ao abrir NAO e fatal e nao vaza detalhe: sessao-indisponivel, e da para tentar de novo', async () => {
    const m = montar();
    m.repo.failLease = true;

    assert.equal(await reasonOf(m.store.open()), 'sessao-indisponivel');
    m.repo.failLease = false;

    assert.deepEqual(m.fatals, []);
    assert.equal(stateOf(await m.store.open()).creds.registered, false);
  });

  it('leitura do banco falha ao abrir: sessao-indisponivel (sem apagar nem recriar nada)', async () => {
    const a = montar();
    await a.store.open();
    await a.store.close();
    const m = montar({ db: a.db });
    m.repo.failReads = true;

    assert.equal(await reasonOf(m.store.open()), 'sessao-indisponivel');

    assert.equal(a.db.items.size, 1);
  });

  it('chave Signal com tipo invalido ou tentando sobrescrever as credenciais: recusado e fatal', async () => {
    for (const tipo of ['creds', 'Tipo Ruim', '', 'x'.repeat(65)]) {
      const m = montar();
      const state = stateOf(await m.store.open());

      await assert.rejects(() => state.keys.set({ [tipo]: { '1': { a: 1 } } }));

      assert.deepEqual(m.fatals, ['falha-gravar-sessao'], tipo);
    }
  });

  it('id de chave grande demais e recusado', async () => {
    const m = montar();
    const state = stateOf(await m.store.open());

    await assert.rejects(() => state.keys.set({ 'pre-key': { ['x'.repeat(256)]: { a: 1 } } }));
  });
});

describe('EncryptedSessionStore - invalidacao controlada (logout definitivo)', () => {
  it('apaga SO as linhas desta sessao: outra sessao e a trava ficam intactas', async () => {
    const a = montar({ sessionId: 'uma' });
    const outra = montar({ db: a.db, sessionId: 'outra' });
    await outra.store.open();
    const stateA = stateOf(await a.store.open());
    await stateA.keys.set({ 'pre-key': { '1': { a: 1 } } });
    const itensDaOutra = [...a.db.items.keys()].filter((k) => k.startsWith('outra'));

    await a.store.invalidate();

    assert.deepEqual(
      [...a.db.items.keys()].filter((k) => k.startsWith('uma')),
      [],
    );
    assert.deepEqual(
      [...a.db.items.keys()].filter((k) => k.startsWith('outra')),
      itensDaOutra,
    );
    assert.ok(a.db.leases.has('uma'), 'a linha da trava nao e apagada');
  });

  it('depois de invalidar, abrir cria uma sessao NOVA (novo pareamento), nao reaproveita a antiga', async () => {
    const m = montar();
    const velho = stateOf(await m.store.open());
    velho.creds.marker = 77;
    await m.store.invalidate();
    await m.store.close();

    const novo = stateOf(await montar({ db: m.db }).store.open());

    assert.equal(novo.creds.marker, undefined);
    assert.equal(novo.creds.registered, false);
  });

  it('sem a trava (outra instancia) nao invalida a sessao dela', async () => {
    const a = montar();
    await a.store.open();
    const b = montar({ db: a.db });

    assert.equal(await reasonOf(b.store.invalidate()), 'sessao-em-uso');

    assert.equal(a.db.items.size, 1);
  });
});

describe('EncryptedSessionStore - verify() e close()', () => {
  it('verify: vazia nao cria nada; valida confere a chave; chave errada e ilegivel', async () => {
    const m = montar();
    assert.equal(await m.store.verify(), 'vazia');
    assert.equal(m.db.items.size, 0);
    await m.store.close();

    const criada = montar({ db: m.db });
    await criada.store.open();
    await criada.store.close();

    const certa = montar({ db: m.db });
    assert.equal(await certa.store.verify(), 'valida');
    await certa.store.close();
    assert.equal(
      await reasonOf(montar({ db: m.db, key: randomBytes(KEY_BYTES) }).store.verify()),
      'sessao-ilegivel',
    );
  });

  it('verify com chaves sem credenciais: ilegivel (nunca "vazia")', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());
    await keys.set({ 'pre-key': { '1': { a: 1 } } });
    await m.store.close();
    m.db.items.delete(MemoryDatabase.key(SESSION, 'creds', '-'));

    assert.equal(await reasonOf(montar({ db: m.db }).store.verify()), 'sessao-ilegivel');
  });

  it('close() espera as escritas pendentes, solta a trava e e idempotente', async () => {
    const m = montar();
    const { keys } = stateOf(await m.store.open());

    void keys.set({ 'pre-key': { '1': { a: 1 } } });
    await m.store.close();
    await m.store.close();

    assert.equal(m.db.items.size, 2, 'a escrita pendente foi concluida antes de soltar a trava');
    assert.equal(m.scheduler.active, 0);
    assert.ok(await new MemorySessionRepository(m.db).acquireLease(SESSION, 'outro', TTL));
  });
});
