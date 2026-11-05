import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DisconnectReason, jidDecode } from '@whiskeysockets/baileys';
import { DISCONNECT } from './constants.js';
import { createBaileysSocketFactory } from './baileys-socket.js';
import { parseJid } from './message-filter.js';

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
