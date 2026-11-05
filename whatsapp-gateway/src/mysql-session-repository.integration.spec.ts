import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import mysql, { type Connection } from 'mysql2/promise';
import { baileysAuthCodec } from './baileys-auth-codec.js';
import { EncryptedSessionStore } from './encrypted-session-store.js';
import { MysqlSessionRepository } from './mysql-session-repository.js';
import { SessionUnavailableError, type SessionHandle } from './ports.js';
import { KEY_BYTES, SessionCipher } from './session-crypto.js';
import { LeaseLostError } from './session-repository.js';
import { FakeScheduler } from './testing/fakes.js';

/**
 * TESTE DE INTEGRACAO CONTRA UM MYSQL REAL. Fica DESLIGADO por padrao (o `npm test` nao tem banco).
 *
 * Para rodar: defina `GATEWAY_TEST_MYSQL_ROOT_URL` (ex.: `mysql://root@127.0.0.1:3307`) apontando para um MySQL
 * DESCARTAVEL de desenvolvimento (nunca o da VPS). O teste cria o banco `wa_it`, aplica o DDL REAL da migration do
 * backend (lido do arquivo, sem copia), cria um usuario restrito e usa SO ele. Dados e segredos sao fictiticios.
 */
const ROOT_URL = process.env.GATEWAY_TEST_MYSQL_ROOT_URL;
const DB = 'wa_it';
const USER = 'wa_gw';
const PASSWORD = `senha-ficticia-${randomBytes(6).toString('hex')}`;
const SESSION = 'principal';
const KEY = randomBytes(KEY_BYTES);

function migrationDdl(): string[] {
  const arquivo = join(
    import.meta.dirname,
    '..',
    '..',
    'backend',
    'src',
    'database',
    'migrations',
    'mysql',
    '1791800000000-WhatsappAuthState.ts',
  );
  const texto = readFileSync(arquivo, 'utf8');
  const ddl = [...texto.matchAll(/`(CREATE TABLE[\s\S]*?ENGINE=InnoDB)`/g)].map((m) =>
    (m[1] ?? '').replace(/\\`/g, '`'),
  );
  assert.equal(ddl.length, 2, 'a migration deve criar exatamente 2 tabelas');
  return ddl;
}

describe(
  'MySQL REAL - repositorio, trava e armazenamento cifrado',
  { skip: ROOT_URL === undefined },
  () => {
    let root: Connection;
    let port: string;
    const repos: MysqlSessionRepository[] = [];
    const novoRepo = (): MysqlSessionRepository => {
      const repo = new MysqlSessionRepository({
        host: '127.0.0.1',
        port: Number(port),
        database: DB,
        user: USER,
        password: PASSWORD,
      });
      repos.push(repo);
      return repo;
    };
    const novaLoja = (repo = novoRepo(), key = KEY, sessionId = SESSION): EncryptedSessionStore =>
      new EncryptedSessionStore({
        repository: repo,
        cipher: new SessionCipher(key),
        codec: baileysAuthCodec,
        scheduler: new FakeScheduler(),
        sessionId,
        owner: randomBytes(8).toString('hex'),
        leaseTtlMs: 30_000,
      });
    const limpar = async (): Promise<void> => {
      await root.query(`DELETE FROM \`${DB}\`.whatsapp_auth_state`);
      await root.query(`DELETE FROM \`${DB}\`.whatsapp_auth_lock`);
    };
    const razao = async (p: Promise<unknown>): Promise<string> => {
      try {
        await p;
      } catch (e) {
        assert.ok(e instanceof SessionUnavailableError, String(e));
        return e.reason;
      }
      throw new assert.AssertionError({ message: 'deveria falhar' });
    };

    before(async () => {
      assert.ok(ROOT_URL !== undefined);
      const url = new URL(ROOT_URL);
      port = url.port;
      root = await mysql.createConnection({ uri: ROOT_URL, multipleStatements: false });
      await root.query(`DROP DATABASE IF EXISTS \`${DB}\``);
      await root.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
      for (const ddl of migrationDdl()) {
        await root.query({ sql: ddl.replace('CREATE TABLE `', `CREATE TABLE \`${DB}\`.\``) });
      }
      await root.query(
        `CREATE TABLE \`${DB}\`.outra_tabela (id int PRIMARY KEY, dado varchar(20))`,
      );
      await root.query(`INSERT INTO \`${DB}\`.outra_tabela VALUES (1, 'intocavel')`);
      await root.query(`DROP USER IF EXISTS '${USER}'@'%'`);
      await root.query(`CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}'`);
      for (const tabela of ['whatsapp_auth_state', 'whatsapp_auth_lock']) {
        await root.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB}\`.\`${tabela}\` TO '${USER}'@'%'`,
        );
      }
    });

    after(async () => {
      await Promise.all(repos.map((r) => r.close().catch(() => undefined)));
      await root.query(`DROP DATABASE IF EXISTS \`${DB}\``);
      await root.query(`DROP USER IF EXISTS '${USER}'@'%'`);
      await root.end();
    });

    it('usuario restrito: acessa so as duas tabelas da sessao e nada mais', async () => {
      const conn = await mysql.createConnection({
        host: '127.0.0.1',
        port: Number(port),
        user: USER,
        password: PASSWORD,
        database: DB,
      });
      try {
        await conn.query('SELECT COUNT(*) FROM whatsapp_auth_state');
        await conn.query('SELECT COUNT(*) FROM whatsapp_auth_lock');
        for (const sql of [
          'SELECT * FROM outra_tabela',
          'INSERT INTO outra_tabela VALUES (2, "x")',
          'DELETE FROM outra_tabela',
          'DROP TABLE whatsapp_auth_state',
          'ALTER TABLE whatsapp_auth_state ADD COLUMN x int',
          'CREATE TABLE t (id int)',
          'TRUNCATE whatsapp_auth_state',
        ]) {
          await assert.rejects(
            () => conn.query(sql),
            (e: { errno?: number }) => [1142, 1044, 1143].includes(e.errno ?? 0),
            sql,
          );
        }
      } finally {
        await conn.end();
      }
      const [linhas] = await root.query<mysql.RowDataPacket[]>(
        `SELECT dado FROM \`${DB}\`.outra_tabela`,
      );
      assert.equal(linhas[0]?.dado, 'intocavel');
    });

    it('trava: exclusiva, reentrante, renovavel so pelo dono, solta ao liberar e EXPIRA pelo relogio do banco', async () => {
      await limpar();
      const repo = novoRepo();

      assert.equal(await repo.acquireLease(SESSION, 'A', 1500), true);
      assert.equal(await repo.acquireLease(SESSION, 'B', 1500), false);
      assert.equal(await repo.acquireLease(SESSION, 'A', 1500), true, 'o mesmo dono pode retomar');
      assert.equal(await repo.renewLease(SESSION, 'A', 1500), true);
      assert.equal(await repo.renewLease(SESSION, 'B', 1500), false);

      await repo.releaseLease(SESSION, 'B'); // quem nao e dono nao solta
      assert.equal(await repo.acquireLease(SESSION, 'B', 1500), false);
      await repo.releaseLease(SESSION, 'A');
      assert.equal(await repo.renewLease(SESSION, 'A', 1500), false, 'liberada nao ressuscita');
      assert.equal(await repo.acquireLease(SESSION, 'B', 1500), true);

      await new Promise((r) => setTimeout(r, 1800)); // B nao renovou: expira
      assert.equal(
        await repo.renewLease(SESSION, 'B', 1500),
        false,
        'trava expirada nao pode ser renovada',
      );
      assert.equal(await repo.acquireLease(SESSION, 'C', 1500), true, 'expirada pode ser assumida');
    });

    it('corrida pela PRIMEIRA trava: com 10 donos simultaneos, exatamente um vence', async () => {
      await limpar();
      const repo = novoRepo();

      const resultados = await Promise.all(
        Array.from({ length: 10 }, (_v, i) =>
          repo.acquireLease('corrida', `dono-${String(i)}`, 20_000),
        ),
      );

      assert.equal(resultados.filter(Boolean).length, 1);
    });

    it('escrita: payload BINARIO identico (todos os 256 bytes), upsert, delete, contagem e atomicidade', async () => {
      await limpar();
      const repo = novoRepo();
      await repo.acquireLease(SESSION, 'A', 30_000);
      const binario = Buffer.from(Array.from({ length: 256 }, (_v, i) => i));

      await repo.writeBatch(SESSION, 'A', {
        upserts: [
          { type: 'pre-key', id: '1', payload: binario },
          { type: 'pre-key', id: '2', payload: Buffer.from('dois') },
        ],
        deletes: [],
      });
      const [lido] = await repo.readItems(SESSION, 'pre-key', ['1']);
      assert.deepEqual(lido?.payload, binario);

      await repo.writeBatch(SESSION, 'A', {
        upserts: [{ type: 'pre-key', id: '1', payload: Buffer.from('novo') }],
        deletes: [{ type: 'pre-key', id: '2' }],
      });
      assert.deepEqual(
        (await repo.readItems(SESSION, 'pre-key', ['1', '2'])).map((i) => i.id),
        ['1'],
      );
      assert.equal(await repo.countItems(SESSION), 1);

      // Atomico: um item invalido (id acima de 255) desfaz o lote INTEIRO.
      await assert.rejects(() =>
        repo.writeBatch(SESSION, 'A', {
          upserts: [
            { type: 'pre-key', id: 'valido', payload: Buffer.from('x') },
            { type: 'pre-key', id: 'x'.repeat(300), payload: Buffer.from('y') },
          ],
          deletes: [],
        }),
      );
      assert.equal(await repo.countItems(SESSION), 1, 'nada do lote falho ficou gravado');
    });

    it('dono ANTIGO nao grava depois que outro assumiu a trava (LeaseLostError, banco intacto)', async () => {
      await limpar();
      const repo = novoRepo();
      await repo.acquireLease(SESSION, 'A', 1000);
      await repo.writeBatch(SESSION, 'A', {
        upserts: [{ type: 'creds', id: '-', payload: Buffer.from('A1') }],
        deletes: [],
      });
      await new Promise((r) => setTimeout(r, 1300));
      assert.equal(await repo.acquireLease(SESSION, 'B', 30_000), true);

      await assert.rejects(
        () =>
          repo.writeBatch(SESSION, 'A', {
            upserts: [{ type: 'creds', id: '-', payload: Buffer.from('A2') }],
            deletes: [],
          }),
        LeaseLostError,
      );
      await assert.rejects(() => repo.deleteSession(SESSION, 'A'), LeaseLostError);

      assert.deepEqual(
        (await repo.readItems(SESSION, 'creds', ['-']))[0]?.payload,
        Buffer.from('A1'),
      );
    });

    it('deleteSession apaga so a sessao do dono: outras sessoes e a linha da trava ficam', async () => {
      await limpar();
      const repo = novoRepo();
      await repo.acquireLease('s1', 'A', 30_000);
      await repo.acquireLease('s2', 'A', 30_000);
      for (const s of ['s1', 's2']) {
        await repo.writeBatch(s, 'A', {
          upserts: [{ type: 'creds', id: '-', payload: Buffer.from(s) }],
          deletes: [],
        });
      }

      await repo.deleteSession('s1', 'A');

      assert.equal(await repo.countItems('s1'), 0);
      assert.equal(await repo.countItems('s2'), 1);
      const [trava] = await root.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM \`${DB}\`.whatsapp_auth_lock`,
      );
      assert.equal(Number(trava[0]?.n), 2);
    });

    it('ARMAZENAMENTO CIFRADO ponta a ponta: sobrevive a "reiniciar" (novo pool e nova instancia), sem nada em claro', async () => {
      await limpar();
      const a = novaLoja();
      const handle = await a.open();
      const state = handle.state as {
        creds: { registered: boolean; noiseKey: { private: Buffer } };
        keys: {
          get(t: string, i: string[]): Promise<Record<string, unknown>>;
          set(d: object): Promise<void>;
        };
      };
      const segredo = Buffer.from(state.creds.noiseKey.private);
      state.creds.registered = true;
      await handle.save();
      await state.keys.set({
        session: { 'pessoa.0': new Uint8Array(randomBytes(64)) },
        'pre-key': { '3': { private: randomBytes(32), public: randomBytes(32) } },
      });
      await a.close();

      const [linhas] = await root.query<mysql.RowDataPacket[]>(
        `SELECT payload FROM \`${DB}\`.whatsapp_auth_state`,
      );
      assert.equal(linhas.length, 3);
      for (const linha of linhas) {
        const payload = linha.payload as Buffer;
        assert.ok(!payload.includes(segredo), 'chave privada em claro no MySQL');
        assert.ok(!payload.toString('latin1').includes('noiseKey'), 'estrutura em claro no MySQL');
        assert.equal(payload[0], 1);
      }

      const b = novaLoja(); // novo pool, nova instancia, mesma chave
      const reaberto = (await b.open()).state as typeof state;
      assert.equal(reaberto.creds.registered, true);
      assert.deepEqual(Buffer.from(reaberto.creds.noiseKey.private), segredo);
      assert.equal(Object.keys(await reaberto.keys.get('session', ['pessoa.0'])).length, 1);
      await b.close();
    });

    it('chave ERRADA nao abre e NAO altera o banco; a chave certa abre depois', async () => {
      await limpar();
      const a = novaLoja();
      await a.open();
      await a.close();
      const [antes] = await root.query<mysql.RowDataPacket[]>(
        `SELECT HEX(payload) AS h FROM \`${DB}\`.whatsapp_auth_state`,
      );

      const errada = novaLoja(novoRepo(), randomBytes(KEY_BYTES));
      assert.equal(await razao(errada.open()), 'sessao-ilegivel');

      const [depois] = await root.query<mysql.RowDataPacket[]>(
        `SELECT HEX(payload) AS h FROM \`${DB}\`.whatsapp_auth_state`,
      );
      assert.deepEqual(depois, antes);
      const certa = novaLoja();
      assert.equal(
        ((await certa.open()).state as { creds: { registered: boolean } }).creds.registered,
        false,
      );
      await certa.close();
    });

    it('INSTANCIA UNICA: a segunda loja recusa (sessao-em-uso) e assume depois que a primeira fecha', async () => {
      await limpar();
      const a = novaLoja();
      await a.open();
      const b = novaLoja();

      assert.equal(await razao(b.open()), 'sessao-em-uso');

      await a.close();
      const aberta: SessionHandle = await b.open();
      assert.ok(aberta.state !== undefined);
      await b.close();
    });

    it('concorrencia real: 40 lotes simultaneos + creds.update sem perder nada', async () => {
      await limpar();
      const a = novaLoja();
      const handle = await a.open();
      const state = handle.state as {
        creds: { marker?: number };
        keys: {
          get(t: string, i: string[]): Promise<Record<string, unknown>>;
          set(d: object): Promise<void>;
        };
      };

      const tarefas: Promise<void>[] = [];
      for (let i = 0; i < 40; i += 1) {
        state.creds.marker = i;
        tarefas.push(
          handle.save(),
          state.keys.set({
            'pre-key': { [String(i)]: { private: randomBytes(32), public: randomBytes(32) } },
          }),
        );
      }
      await Promise.all(tarefas);
      await a.close();

      const b = novaLoja();
      const reaberto = (await b.open()).state as typeof state;
      assert.equal(reaberto.creds.marker, 39);
      assert.equal(
        Object.keys(
          await reaberto.keys.get(
            'pre-key',
            Array.from({ length: 40 }, (_v, i) => String(i)),
          ),
        ).length,
        40,
      );
      await b.close();
    });

    it('logout definitivo: invalidate apaga so esta sessao no MySQL real', async () => {
      await limpar();
      const outra = novaLoja(novoRepo(), KEY, 'outra');
      await outra.open();
      const a = novaLoja();
      await a.open();

      await a.invalidate();

      const [linhas] = await root.query<mysql.RowDataPacket[]>(
        `SELECT session_id, COUNT(*) AS n FROM \`${DB}\`.whatsapp_auth_state GROUP BY session_id`,
      );
      assert.deepEqual(
        linhas.map((l) => [String(l.session_id), Number(l.n)]),
        [['outra', 1]],
      );
      await a.close();
      await outra.close();
    });
  },
);
