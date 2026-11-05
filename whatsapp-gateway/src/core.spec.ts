import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCONNECT } from './constants.js';
import { JsonLogger, MemoryLogger, sanitizeFields } from './logger.js';
import { decideReconnect, DEFAULT_RECONNECT } from './reconnect-policy.js';
import { ReplyLimiter } from './reply-limiter.js';
import { SeenIds } from './seen-ids.js';

describe('SeenIds (primeira barreira contra reentrega)', () => {
  it('o mesmo id so passa uma vez dentro do prazo', () => {
    const seen = new SeenIds(100, 1000);

    assert.equal(seen.check('A', 0), false);
    assert.equal(seen.check('A', 500), true);
    assert.equal(seen.check('B', 500), false);
  });

  it('depois do prazo o id volta a ser aceito (o backend continua sendo a autoridade)', () => {
    const seen = new SeenIds(100, 1000);
    seen.check('A', 0);

    assert.equal(seen.check('A', 1500), false);
  });

  it('a memoria e limitada: ids mais antigos saem primeiro', () => {
    const seen = new SeenIds(3, 10_000);
    for (const id of ['1', '2', '3', '4', '5']) seen.check(id, 0);

    assert.ok(seen.size <= 3);
    assert.equal(seen.check('5', 1), true);
    assert.equal(seen.check('1', 1), false);
  });
});

describe('ReplyLimiter (limite global de respostas)', () => {
  it('permite N por janela e descarta o excesso', () => {
    const limiter = new ReplyLimiter(3, 60_000);

    assert.deepEqual(
      [0, 1, 2, 3, 4].map((i) => limiter.tryTake(i)),
      [true, true, true, false, false],
    );
  });

  it('libera de novo quando a janela passa', () => {
    const limiter = new ReplyLimiter(2, 60_000);
    limiter.tryTake(0);
    limiter.tryTake(1);

    assert.equal(limiter.tryTake(30_000), false);
    assert.equal(limiter.tryTake(60_000), true);
  });
});

describe('decideReconnect (politica por DisconnectReason)', () => {
  const sem = (): number => 0.5; // jitter neutro

  for (const [nome, codigo, motivo] of [
    ['loggedOut', DISCONNECT.loggedOut, 'desvinculado'],
    ['connectionReplaced', DISCONNECT.connectionReplaced, 'sessao-substituida'],
    ['badSession', DISCONNECT.badSession, 'sessao-corrompida'],
    ['forbidden', DISCONNECT.forbidden, 'acesso-negado'],
    ['multideviceMismatch', DISCONNECT.multideviceMismatch, 'versao-incompativel'],
  ] as const) {
    it(`${nome} (${String(codigo)}): PARA, em qualquer tentativa`, () => {
      for (const attempt of [0, 1, 5]) {
        assert.deepEqual(decideReconnect(codigo, attempt, DEFAULT_RECONNECT, sem), {
          action: 'stop',
          reason: motivo,
        });
      }
    });
  }

  it('restartRequired (515): reconecta ja, sem atraso', () => {
    assert.deepEqual(decideReconnect(DISCONNECT.restartRequired, 0, DEFAULT_RECONNECT, sem), {
      action: 'reconnect',
      delayMs: 0,
    });
  });

  it('queda comum: backoff exponencial ate o teto', () => {
    const atrasos = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => {
      const d = decideReconnect(DISCONNECT.connectionClosed, n, DEFAULT_RECONNECT, sem);
      return d.action === 'reconnect' ? d.delayMs : -1;
    });

    assert.deepEqual(atrasos, [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });

  it('codigo desconhecido ou ausente tambem usa backoff (nunca reconexao instantanea)', () => {
    for (const codigo of [undefined, null, 0, 999]) {
      const d = decideReconnect(codigo, 0, DEFAULT_RECONNECT, sem);
      assert.deepEqual(d, { action: 'reconnect', delayMs: 2000 });
    }
  });

  it('desiste depois do limite de tentativas seguidas', () => {
    assert.deepEqual(
      decideReconnect(
        DISCONNECT.connectionLost,
        DEFAULT_RECONNECT.maxAttempts,
        DEFAULT_RECONNECT,
        sem,
      ),
      {
        action: 'stop',
        reason: 'tentativas-esgotadas',
      },
    );
  });

  it('o jitter varia o atraso em +-20% e nunca fica negativo', () => {
    const baixo = decideReconnect(DISCONNECT.timedOut, 0, DEFAULT_RECONNECT, () => 0);
    const alto = decideReconnect(DISCONNECT.timedOut, 0, DEFAULT_RECONNECT, () => 1);

    assert.deepEqual(baixo, { action: 'reconnect', delayMs: 1600 });
    assert.deepEqual(alto, { action: 'reconnect', delayMs: 2400 });
  });
});

describe('logger (vocabulario fixo, sem dados)', () => {
  it('descarta texto livre, JID e qualquer valor que lembre numero', () => {
    const limpo = sanitizeFields({
      motivo: 'grupo',
      tentativa: 3,
      ok: true,
      jid: '5511999990001@s.whatsapp.net',
      numero: '5511999990001',
      texto: 'oi, quero o saldo da conta',
      token: 'vfs_' + 'A'.repeat(43),
      'campo invalido': 'x',
      infinito: Number.POSITIVE_INFINITY,
    });

    assert.deepEqual(limpo, {
      motivo: 'grupo',
      tentativa: 3,
      ok: true,
      jid: '[omitido]',
      numero: '[omitido]',
      texto: '[omitido]',
      token: '[omitido]',
      infinito: null,
    });
  });

  it('JsonLogger escreve uma linha JSON com o evento e so campos filtrados', () => {
    const linhas: string[] = [];
    const logger = new JsonLogger(
      (l) => linhas.push(l),
      () => 0,
    );

    logger.event('mensagem-ignorada', { motivo: 'propria', texto: '/financeiro segredo' });

    assert.equal(linhas.length, 1);
    assert.deepEqual(JSON.parse(linhas[0] ?? ''), {
      t: '1970-01-01T00:00:00.000Z',
      ev: 'mensagem-ignorada',
      motivo: 'propria',
      texto: '[omitido]',
    });
  });

  it('MemoryLogger guarda os eventos ja filtrados', () => {
    const logger = new MemoryLogger();

    logger.event('parado', { motivo: '5511999990001' });

    assert.deepEqual(logger.events, [{ name: 'parado', fields: { motivo: '[omitido]' } }]);
  });
});
