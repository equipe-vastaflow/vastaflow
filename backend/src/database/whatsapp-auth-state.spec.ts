import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { QueryRunner } from 'typeorm';
import { DatabaseType } from '../config/env.validation';
import { MIGRATIONS } from './migrations';

/**
 * As tabelas do estado de autenticacao do WhatsApp (sessao do gateway Baileys) sao SENSIVEIS e pertencem ao gateway:
 * o backend so as cria (migration) e nunca as le. Estas regras impedem que isso mude sem querer.
 */
const SRC = join(__dirname, '..');
const TABLES = ['whatsapp_auth_state', 'whatsapp_auth_lock'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? sources(caminho) : [caminho];
  });
}

async function sqlOf(type: DatabaseType, direction: 'up' | 'down'): Promise<string[]> {
  const Migration = MIGRATIONS[type].find((m) => m.name === 'WhatsappAuthState1791800000000');
  if (Migration === undefined) {
    throw new Error('migration nao registrada');
  }
  const statements: string[] = [];
  const runner = {
    query: (sql: string): Promise<void> => {
      statements.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new Migration()[direction](runner);
  return statements;
}

describe('estado de autenticacao do WhatsApp - schema', () => {
  it.each(Object.values(DatabaseType))(
    '%s: a migration cria as duas tabelas e o down as remove',
    async (type) => {
      const up = (await sqlOf(type, 'up')).join('\n');
      const down = (await sqlOf(type, 'down')).join('\n');

      for (const tabela of TABLES) {
        expect(up).toMatch(new RegExp(String.raw`CREATE TABLE [\x60"]${tabela}[\x60"]`));
        expect(down).toMatch(new RegExp(String.raw`DROP TABLE [\x60"]${tabela}[\x60"]`));
      }
    },
  );

  it.each(Object.values(DatabaseType))(
    '%s: o estado so guarda BLOB (texto cifrado), com chave composta (sessao, tipo, id); a trava e uma linha por sessao',
    async (type) => {
      const up = (await sqlOf(type, 'up')).join('\n');

      expect(up).toMatch(type === DatabaseType.Mysql ? /mediumblob/ : /\bblob\b/i);
      expect(up).toMatch(/PRIMARY KEY \([`"]session_id[`"], [`"]item_type[`"], [`"]item_id[`"]\)/);
      expect(up).toMatch(/PRIMARY KEY \([`"]session_id[`"]\)/);
      // Nenhuma coluna de texto claro para credenciais.
      expect(up).not.toMatch(/\b(creds|password|senha|secret|private)/i);
    },
  );

  it('o backend NAO le nem escreve estas tabelas: so as migrations (e este teste) as citam', () => {
    const citam = sources(SRC)
      .filter((arquivo) => /\.(ts|js)$/.test(arquivo))
      .filter((arquivo) => TABLES.some((tabela) => readFileSync(arquivo, 'utf8').includes(tabela)))
      .map((arquivo) => relative(SRC, arquivo).split('\\').join('/'))
      .sort();

    expect(citam).toEqual([
      'database/migrations/mysql/1791800000000-WhatsappAuthState.ts',
      'database/migrations/oracle/1791800000000-WhatsappAuthState.ts',
      'database/whatsapp-auth-state.spec.ts',
      'deploy-config.spec.ts',
    ]);
  });
});
