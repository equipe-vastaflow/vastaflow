import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const SRC = join(import.meta.dirname, '..', 'src');

const FONTES = readdirSync(SRC)
  .filter((a) => a.endsWith('.ts') && !a.endsWith('.spec.ts'))
  .map((arquivo) => ({ arquivo, codigo: readFileSync(join(SRC, arquivo), 'utf8') }));

const semComentarios = (codigo: string): string =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsDe = (codigo: string): string[] =>
  [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem ?? '');
const fonte = (arquivo: string): string =>
  semComentarios(FONTES.find((f) => f.arquivo === arquivo)?.codigo ?? '');
const quem = (padrao: RegExp): string[] =>
  FONTES.filter(({ codigo }) => padrao.test(semComentarios(codigo)))
    .map(({ arquivo }) => arquivo)
    .sort();

describe('Arquitetura do armazenamento da sessao', () => {
  it('SO o repositorio MySQL importa o driver e contem SQL', () => {
    assert.deepEqual(
      FONTES.filter(({ codigo }) => importsDe(codigo).includes('mysql2/promise')).map(
        (f) => f.arquivo,
      ),
      ['mysql-session-repository.ts'],
    );
    assert.deepEqual(quem(/(SELECT|INSERT INTO|DELETE FROM) /), ['mysql-session-repository.ts']);
  });

  it('nenhum valor e concatenado no SQL: so parametros', () => {
    const repo = fonte('mysql-session-repository.ts');
    const linhasSql = repo
      .split('\n')
      .filter((linha) => /'(SELECT |INSERT INTO |DELETE FROM |UPDATE )/.test(linha));

    assert.ok(linhasSql.length >= 10);
    for (const linha of linhasSql) {
      assert.doesNotMatch(linha, /\$\{/, `SQL com interpolacao: ${linha.trim()}`);
      assert.doesNotMatch(linha, /' \+ |\+ '/, `SQL concatenado: ${linha.trim()}`);
    }
  });

  it('o SQL toca SOMENTE as duas tabelas da sessao, e todo DELETE e restrito a UMA sessao', () => {
    const repo = fonte('mysql-session-repository.ts');
    // (`ON DUPLICATE KEY UPDATE <coluna>` nao e uma tabela)
    const tabelas = new Set(
      [...repo.matchAll(/(?:FROM|INTO|(?<!KEY )UPDATE)\s+`(\w+)`/g)].map((m) => m[1]),
    );

    assert.deepEqual([...tabelas].sort(), ['whatsapp_auth_lock', 'whatsapp_auth_state']);
    const deletes = [...repo.matchAll(/'(DELETE FROM[^']*)'/g)].map((m) => m[1] ?? '');
    assert.equal(deletes.length, 2);
    for (const sql of deletes) {
      assert.match(sql, /WHERE `session_id` = \?/);
      assert.match(sql, /whatsapp_auth_state/);
    }
    assert.doesNotMatch(repo, /DROP |TRUNCATE |ALTER |CREATE /i);
  });

  it('a cifra e o gerador aleatorio so existem em session-crypto.ts (e o randomUUID da trava, em main.ts)', () => {
    assert.deepEqual(quem(/from 'node:crypto'/), ['main.ts', 'session-crypto.ts']);
    assert.doesNotMatch(fonte('main.ts'), /createCipheriv|createDecipheriv|createHash/);
  });

  it('chave de cifra e senha do banco: so config, main e quem as consome; nunca em log', () => {
    assert.deepEqual(quem(/encryptionKey/), ['config.ts', 'main.ts']);
    assert.deepEqual(quem(/options\.password|db\.password/), ['mysql-session-repository.ts']);
    for (const arquivo of [
      'session-crypto.ts',
      'encrypted-session-store.ts',
      'mysql-session-repository.ts',
    ]) {
      assert.doesNotMatch(fonte(arquivo), /logger|Logger|console\./, arquivo);
    }
  });

  it('o armazenamento nunca devolve o erro do driver: sempre mensagens fixas', () => {
    const store = fonte('encrypted-session-store.ts');

    assert.doesNotMatch(store, /error\.message|String\(error\)|\.stack|throw error|throw e\b/);
    // Todo `catch` captura sem repassar o objeto de erro (ou so testa o tipo).
    for (const m of store.matchAll(/catch \((\w+)\) \{([^}]*)\}/g)) {
      const [, nome = '', corpo = ''] = m;
      assert.doesNotMatch(corpo, new RegExp(`\\b(throw|reject)\\b[^;]*\\b${nome}\\b`));
    }
  });

  it('o placeholder que recusava abrir a sessao sumiu e o interruptor da conexao nasce DESLIGADO', () => {
    assert.ok(!FONTES.some((f) => f.arquivo === 'session-store.ts'));
    assert.deepEqual(quem(/NotImplementedSessionStore/), []);
    assert.match(fonte('config.ts'), /connectEnabled: connect === 'true'/);
    assert.match(
      fonte('main.ts'),
      /if \(!config\.connectEnabled\) \{[\s\S]*store\.verify\(\)[\s\S]*return;/,
    );
  });

  it('o gateway nunca le nem escreve disco: a sessao so existe no banco, cifrada', () => {
    assert.deepEqual(quem(/from 'node:fs/), ['main.ts']);
    assert.match(fonte('main.ts'), /readFileSync\(path, 'utf8'\)/);
    assert.deepEqual(quem(/writeFile|createWriteStream|appendFile|useMultiFileAuthState/), []);
  });
});
