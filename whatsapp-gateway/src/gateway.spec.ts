import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCONNECT } from './constants.js';
import { Gateway } from './gateway.js';
import { IngestError } from './ingest-client.js';
import { MemoryLogger } from './logger.js';
import type { IngestRequest, RawWaMessage } from './ports.js';
import {
  ACCOUNT,
  FakeClock,
  FakeIngest,
  FakeScheduler,
  FakeSessionStore,
  flush,
  SENDER,
  SocketFarm,
  T0_MS,
  textMessage,
} from './testing/fakes.js';

interface Options {
  maxRepliesPerMinute?: number;
  maxQueue?: number;
  sendTimeoutMs?: number;
}

// Helper de teste: o tipo de retorno e o da propria montagem (inferido).
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function montar(options: Options = {}) {
  const clock = new FakeClock();
  const scheduler = new FakeScheduler();
  const farm = new SocketFarm();
  const sessions = new FakeSessionStore();
  const ingest = new FakeIngest();
  const logger = new MemoryLogger();
  const gateway = new Gateway({
    socketFactory: farm.factory,
    sessions,
    ingest,
    config: {
      account: ACCOUNT,
      sendTimeoutMs: options.sendTimeoutMs ?? 1000,
      maxRepliesPerMinute: options.maxRepliesPerMinute ?? 20,
      maxQueue: options.maxQueue ?? 100,
    },
    clock,
    scheduler,
    logger,
    random: () => 0.5,
  });
  const abrir = async (): Promise<void> => {
    await gateway.start();
    farm.last.emitConnection({ connection: 'open' });
    await flush();
  };
  return { clock, scheduler, farm, sessions, ingest, logger, gateway, abrir };
}

describe('Gateway - mensagens', () => {
  it('encaminha ao backend o contrato exato e responde SO ao chat de origem', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([textMessage({ text: '/ajuda', id: 'ABC' })]);
    await flush();

    assert.deepEqual(m.ingest.calls, [
      {
        version: 1,
        messageId: 'ABC',
        from: SENDER,
        to: ACCOUNT,
        chatType: 'private',
        text: '/ajuda',
        timestamp: Math.floor(T0_MS / 1000),
      } satisfies IngestRequest,
    ]);
    assert.deepEqual(m.farm.last.sent, [
      { chatJid: `${SENDER}@s.whatsapp.net`, text: 'Comandos disponiveis' },
    ]);
  });

  it('chat LID: o backend recebe o NUMERO, e a resposta vai ao proprio chat LID de origem', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([
      textMessage({
        key: {
          id: 'L1',
          remoteJid: '123456789012345@lid',
          remoteJidAlt: `${SENDER}@s.whatsapp.net`,
          fromMe: false,
        },
      }),
    ]);
    await flush();

    assert.equal(m.ingest.calls[0]?.from, SENDER);
    assert.equal(m.farm.last.sent[0]?.chatJid, '123456789012345@lid');
  });

  it('chat LID SEM telefone verificado: descartado, nunca chama o backend, nunca responde', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([
      textMessage({
        key: { id: 'LS1', remoteJid: '123456789012345@lid', fromMe: false },
        text: '/vincular ABCD1234',
      }),
    ]);
    await flush();

    assert.equal(m.ingest.calls.length, 0);
    assert.equal(m.farm.last.sent.length, 0);
    assert.equal(m.gateway.status().counters['ignorada:lid-sem-telefone'], 1);
  });

  it('LID numericamente igual ao telefone de um usuario vinculado NAO assume a identidade dele', async () => {
    const VITIMA = '5511988887777';
    const m = montar();
    await m.abrir();
    // Backend simulado: so o telefone da VITIMA esta vinculado e recebe comandos; qualquer outro e "nao vinculado".
    const vistos: string[] = [];
    m.ingest.respond = (request) => {
      vistos.push(request.from);
      return Promise.resolve(
        request.from === VITIMA
          ? {
              correlationId: 'e',
              outcome: 'EXECUTED',
              duplicate: false,
              replyTo: VITIMA,
              reply: 'dados da vitima',
            }
          : {
              correlationId: 'e',
              outcome: 'UNLINKED',
              duplicate: false,
              replyTo: null,
              reply: null,
            },
      );
    };

    m.farm.last.emitMessages([
      // O atacante chega como LID cujos digitos sao IGUAIS ao telefone da vitima.
      textMessage({
        key: { id: 'X1', remoteJid: `${VITIMA}@lid`, fromMe: false },
        text: '/financeiro',
      }),
      // ... inclusive com alternativas enganosas.
      textMessage({
        key: { id: 'X2', remoteJid: `${VITIMA}@lid`, remoteJidAlt: `${VITIMA}@lid`, fromMe: false },
        text: '/financeiro',
      }),
      textMessage({
        key: { id: 'X3', remoteJid: `${VITIMA}@lid`, remoteJidAlt: VITIMA, fromMe: false },
        text: '/financeiro',
      }),
      // A vitima de verdade, por telefone, segue funcionando.
      textMessage({
        key: { id: 'V1', remoteJid: `${VITIMA}@s.whatsapp.net`, fromMe: false },
        text: '/financeiro',
      }),
    ]);
    await flush();

    assert.deepEqual(vistos, [VITIMA], 'so a mensagem por TELEFONE chegou ao backend');
    assert.deepEqual(m.farm.last.sent, [
      { chatJid: `${VITIMA}@s.whatsapp.net`, text: 'dados da vitima' },
    ]);
    assert.equal(m.gateway.status().counters['ignorada:lid-sem-telefone'], 2);
    assert.equal(m.gateway.status().counters['ignorada:jid-alt-invalido'], 1);
  });

  it('LID com telefone verificado: a identidade e o TELEFONE e a resposta volta ao chat LID de origem', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([
      textMessage({
        key: {
          id: 'LT1',
          remoteJid: '123456789012345@lid',
          remoteJidAlt: `${SENDER}@s.whatsapp.net`,
          fromMe: false,
        },
      }),
    ]);
    await flush();

    assert.equal(m.ingest.calls[0]?.from, SENDER);
    assert.notEqual(m.ingest.calls[0]?.from, '123456789012345');
    assert.deepEqual(
      m.farm.last.sent.map((s) => s.chatJid),
      ['123456789012345@lid'],
    );
  });

  it('dados contraditorios: descartados sem chamar o backend', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([
      textMessage({
        key: {
          id: 'C1',
          remoteJid: `${SENDER}@s.whatsapp.net`,
          remoteJidAlt: '5511977776666@s.whatsapp.net',
          fromMe: false,
        },
      }),
      textMessage({
        key: {
          id: 'C2',
          remoteJid: `${SENDER}@s.whatsapp.net`,
          participant: '5511977776666@s.whatsapp.net',
          fromMe: false,
        },
      }),
    ]);
    await flush();

    assert.equal(m.ingest.calls.length, 0);
    assert.equal(m.gateway.status().counters['ignorada:identidade-contraditoria'], 2);
  });

  it('nada e processado antes da conexao abrir', async () => {
    const m = montar();
    await m.gateway.start();

    m.farm.last.emitMessages([textMessage()]);
    await flush();

    assert.equal(m.ingest.calls.length, 0);
  });

  it('historico (type append) nunca vira comando', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([textMessage()], 'append');
    await flush();

    assert.equal(m.ingest.calls.length, 0);
    assert.equal(m.gateway.status().counters['ignorada:historico'], 1);
  });

  // [descricao, motivo registrado no contador, mensagem]
  const naoSuportadas: [string, string, RawWaMessage][] = [
    [
      'propria',
      'propria',
      textMessage({ key: { id: 'P', remoteJid: `${SENDER}@s.whatsapp.net`, fromMe: true } }),
    ],
    [
      'grupo',
      'grupo',
      textMessage({ key: { id: 'G', remoteJid: '120363000000000000@g.us', fromMe: false } }),
    ],
    [
      'broadcast',
      'broadcast',
      textMessage({ key: { id: 'B', remoteJid: '1234567890@broadcast', fromMe: false } }),
    ],
    [
      'status',
      'status',
      textMessage({ key: { id: 'S', remoteJid: 'status@broadcast', fromMe: false } }),
    ],
    ['reacao', 'reacao', textMessage({ id: 'R', message: { reactionMessage: {} } })],
    ['edicao', 'edicao', textMessage({ id: 'E', message: { editedMessage: {} } })],
    ['imagem', 'nao-texto', textMessage({ id: 'I', message: { imageMessage: {} } })],
    [
      'antiga',
      'antiga',
      textMessage({ id: 'A', messageTimestamp: Math.floor(T0_MS / 1000) - 3600 }),
    ],
  ];
  for (const [nome, motivo, raw] of naoSuportadas) {
    it(`ignora ${nome}: nao chama o backend e nao responde`, async () => {
      const m = montar();
      await m.abrir();

      m.farm.last.emitMessages([raw]);
      await flush();

      assert.equal(m.ingest.calls.length, 0);
      assert.equal(m.farm.last.sent.length, 0);
      assert.equal(m.gateway.status().counters[`ignorada:${motivo}`], 1);
    });
  }

  it('mensagem repetida (mesmo id): so a primeira vai ao backend', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([textMessage({ id: 'DUP' }), textMessage({ id: 'DUP' })]);
    m.farm.last.emitMessages([textMessage({ id: 'DUP' })]);
    await flush();

    assert.equal(m.ingest.calls.length, 1);
    assert.equal(m.farm.last.sent.length, 1);
    assert.equal(m.gateway.status().counters['ignorada:duplicada'], 2);
  });

  it('processa EM ORDEM, uma por vez', async () => {
    const m = montar();
    await m.abrir();
    const ordem: string[] = [];
    let ativas = 0;
    let maxAtivas = 0;
    m.ingest.respond = async (request) => {
      ativas += 1;
      maxAtivas = Math.max(maxAtivas, ativas);
      await flush(2);
      ordem.push(request.messageId);
      ativas -= 1;
      return {
        correlationId: null,
        outcome: 'UNLINKED',
        duplicate: false,
        replyTo: null,
        reply: null,
      };
    };

    m.farm.last.emitMessages([
      textMessage({ id: '1' }),
      textMessage({ id: '2' }),
      textMessage({ id: '3' }),
    ]);
    await flush(40);

    assert.deepEqual(ordem, ['1', '2', '3']);
    assert.equal(maxAtivas, 1);
  });

  it('fila limitada: o excesso e descartado, nunca acumulado', async () => {
    const m = montar({ maxQueue: 2 });
    await m.abrir();
    m.ingest.respond = async () => {
      await flush(5);
      return {
        correlationId: null,
        outcome: 'UNLINKED',
        duplicate: false,
        replyTo: null,
        reply: null,
      };
    };

    m.farm.last.emitMessages(
      Array.from({ length: 6 }, (_v, i) => textMessage({ id: `Q${String(i)}` })),
    );
    await flush(60);

    assert.ok((m.gateway.status().counters['fila-cheia'] ?? 0) >= 3);
    assert.ok(m.ingest.calls.length <= 3);
  });
});

describe('Gateway - resposta so quando o backend autoriza', () => {
  it('backend em silencio (reply nulo): nada e enviado', async () => {
    const m = montar();
    await m.abrir();
    m.ingest.respond = () =>
      Promise.resolve({
        correlationId: null,
        outcome: 'UNLINKED',
        duplicate: false,
        replyTo: null,
        reply: null,
      });

    m.farm.last.emitMessages([textMessage()]);
    await flush();

    assert.equal(m.farm.last.sent.length, 0);
  });

  it('destino divergente (replyTo diferente do remetente enviado): descartado, nada e enviado', async () => {
    const m = montar();
    await m.abrir();
    m.ingest.respond = () =>
      Promise.resolve({
        correlationId: 'e',
        outcome: 'EXECUTED',
        duplicate: false,
        replyTo: '5511977776666',
        reply: 'oi',
      });

    m.farm.last.emitMessages([textMessage()]);
    await flush();

    assert.equal(m.farm.last.sent.length, 0);
    assert.equal(m.gateway.status().counters['resposta-destino-divergente'], 1);
  });

  it('o destino do envio e SEMPRE o chat guardado da mensagem recebida (nunca montado da resposta)', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitMessages([
      textMessage({
        id: 'U1',
        key: { id: 'U1', remoteJid: `5511911112222@s.whatsapp.net`, fromMe: false },
      }),
      textMessage({
        id: 'U2',
        key: { id: 'U2', remoteJid: `5511933334444@s.whatsapp.net`, fromMe: false },
      }),
    ]);
    await flush();

    assert.deepEqual(
      m.farm.last.sent.map((s) => s.chatJid),
      ['5511911112222@s.whatsapp.net', '5511933334444@s.whatsapp.net'],
    );
  });

  it('limite global de respostas: o excesso e descartado (e volta quando a janela passa)', async () => {
    const m = montar({ maxRepliesPerMinute: 2 });
    await m.abrir();

    m.farm.last.emitMessages([1, 2, 3, 4].map((n) => textMessage({ id: `L${String(n)}` })));
    await flush();
    assert.equal(m.farm.last.sent.length, 2);
    assert.equal(m.gateway.status().counters['resposta-limite'], 2);

    m.clock.advance(61_000);
    m.farm.last.emitMessages([
      textMessage({ id: 'L5', messageTimestamp: Math.floor(m.clock.now() / 1000) }),
    ]);
    await flush();
    assert.equal(m.farm.last.sent.length, 3);
  });
});

describe('Gateway - falhas sem vazamento', () => {
  const SEGREDO = 'SEGREDO-DA-MENSAGEM';

  it('erro do backend: nao responde, nao lanca, e o log traz so o tipo', async () => {
    const m = montar();
    await m.abrir();
    m.ingest.respond = () => Promise.reject(new IngestError('http', 503));

    m.farm.last.emitMessages([textMessage({ text: `/ajuda ${SEGREDO}` })]);
    await flush();

    assert.equal(m.farm.last.sent.length, 0);
    const falha = m.logger.events.find((e) => e.name === 'falha-encaminhar');
    assert.deepEqual(falha?.fields, { tipo: 'http', status: 503 });
  });

  it('erro inesperado do cliente: tratado como falha generica', async () => {
    const m = montar();
    await m.abrir();
    m.ingest.respond = () => Promise.reject(new Error(`boom ${SEGREDO} ${SENDER}`));

    m.farm.last.emitMessages([textMessage()]);
    await flush();

    assert.deepEqual(m.logger.events.find((e) => e.name === 'falha-encaminhar')?.fields, {
      tipo: 'desconhecido',
      status: null,
    });
  });

  it('falha ao enviar: contada, sem lancar; as proximas mensagens seguem', async () => {
    const m = montar();
    await m.abrir();
    let n = 0;
    m.farm.last.sendImpl = () =>
      ++n === 1 ? Promise.reject(new Error(`falha ${SENDER}`)) : Promise.resolve();

    m.farm.last.emitMessages([textMessage({ id: 'F1' }), textMessage({ id: 'F2' })]);
    await flush();

    assert.equal(m.gateway.status().counters['falha-enviar'], 1);
    assert.equal(m.farm.last.sent.length, 1);
  });

  it('envio que nao termina: timeout, e a fila segue', async () => {
    const m = montar({ sendTimeoutMs: 30 });
    await m.abrir();
    m.farm.last.sendImpl = () => new Promise<void>(() => undefined);

    m.farm.last.emitMessages([textMessage({ id: 'T1' }), textMessage({ id: 'T2' })]);
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    await flush();

    assert.equal(m.ingest.calls.length, 2);
    assert.equal(m.gateway.status().counters['falha-enviar'], 2);
  });

  it('NENHUM log traz texto de mensagem, numero, JID ou conta', async () => {
    const m = montar();
    await m.abrir();
    m.ingest.respond = (request) =>
      request.messageId === 'N2'
        ? Promise.reject(new IngestError('timeout'))
        : Promise.resolve({
            correlationId: 'e',
            outcome: 'EXECUTED',
            duplicate: false,
            replyTo: request.from,
            reply: `resposta ${SEGREDO}`,
          });

    m.farm.last.emitMessages([
      textMessage({ id: 'N1', text: `/ajuda ${SEGREDO}` }),
      textMessage({ id: 'N2', text: `/status ${SEGREDO}` }),
      textMessage({
        id: 'N3',
        key: { id: 'N3', remoteJid: '120363000000000000@g.us', fromMe: false },
      }),
    ]);
    await flush();
    m.farm.last.emitConnection({ connection: 'close', closeStatusCode: DISCONNECT.loggedOut });
    await flush();

    const bruto = JSON.stringify(m.logger.events);
    for (const proibido of [SEGREDO, SENDER, ACCOUNT, '@s.whatsapp.net', '@g.us', 'vfs_']) {
      assert.ok(!bruto.includes(proibido), `vazou: ${proibido}`);
    }
    assert.ok(m.logger.events.length > 3);
  });
});

describe('Gateway - conexao, conta e reconexao', () => {
  it('conta conectada diferente da configurada: para e NAO encaminha nada', async () => {
    const m = montar();
    await m.gateway.start();
    m.farm.last.own = '5511977776666';

    m.farm.last.emitConnection({ connection: 'open' });
    await flush();
    m.farm.last.emitMessages([textMessage()]);
    await flush();

    assert.equal(m.gateway.status().state, 'stopped');
    assert.equal(m.gateway.status().stopReason, 'conta-diferente');
    assert.equal(m.farm.last.closed, true);
    assert.equal(m.ingest.calls.length, 0);
  });

  it('conta ainda desconhecida ao abrir: tambem para (nunca encaminha sem saber quem somos)', async () => {
    const m = montar();
    await m.gateway.start();
    m.farm.last.own = null;

    m.farm.last.emitConnection({ connection: 'open' });
    await flush();

    assert.equal(m.gateway.status().stopReason, 'conta-diferente');
  });

  it('sem sessao disponivel: para com motivo claro, sem socket e sem agendar nada', async () => {
    const m = montar();
    m.sessions.failOpen = true;

    await m.gateway.start();

    assert.equal(m.gateway.status().state, 'stopped');
    assert.equal(m.gateway.status().stopReason, 'sessao-indisponivel');
    assert.equal(m.farm.sockets.length, 0);
    assert.equal(m.scheduler.active, 0);
  });

  it('queda comum: agenda reconexao com backoff e cria um NOVO socket', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitConnection({
      connection: 'close',
      closeStatusCode: DISCONNECT.connectionClosed,
    });
    await flush();

    assert.equal(m.gateway.status().state, 'reconnecting');
    assert.equal(m.scheduler.pending[0]?.delayMs, 2000);
    assert.equal(m.farm.sockets[0]?.closed, true);
    m.scheduler.runNext();
    await flush();
    assert.equal(m.farm.sockets.length, 2);
    assert.equal(m.gateway.status().state, 'connecting');
  });

  it('o backoff cresce a cada queda seguida e o limite de tentativas PARA o gateway', async () => {
    const m = montar();
    await m.gateway.start();
    const atrasos: number[] = [];

    for (let i = 0; i < 12 && m.gateway.status().state !== 'stopped'; i += 1) {
      m.farm.last.emitConnection({
        connection: 'close',
        closeStatusCode: DISCONNECT.connectionLost,
      });
      await flush();
      const agendada = m.scheduler.pending[m.scheduler.pending.length - 1];
      if (agendada !== undefined && m.gateway.status().state === 'reconnecting') {
        atrasos.push(agendada.delayMs);
        m.scheduler.runNext();
        await flush();
      }
    }

    assert.deepEqual(atrasos, [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    assert.equal(m.gateway.status().state, 'stopped');
    assert.equal(m.gateway.status().stopReason, 'tentativas-esgotadas');
  });

  it('conexao ESTAVEL (1 min aberta) zera a contagem de quedas', async () => {
    const m = montar();
    await m.abrir();
    m.farm.last.emitConnection({ connection: 'close', closeStatusCode: DISCONNECT.connectionLost });
    await flush();
    m.scheduler.runNext();
    await flush();
    assert.equal(m.gateway.status().attempts, 1);

    m.farm.last.emitConnection({ connection: 'open' });
    await flush();
    m.clock.advance(61_000);
    m.farm.last.emitConnection({ connection: 'close', closeStatusCode: DISCONNECT.connectionLost });
    await flush();

    assert.equal(m.gateway.status().attempts, 1); // zerou e contou a nova queda
    assert.equal(m.scheduler.pending[m.scheduler.pending.length - 1]?.delayMs, 2000);
  });

  it('restartRequired (515) apos o pareamento: reconecta JA e nao conta como falha', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitConnection({
      connection: 'close',
      closeStatusCode: DISCONNECT.restartRequired,
    });
    await flush();

    assert.equal(m.scheduler.pending[0]?.delayMs, 0);
    assert.equal(m.gateway.status().attempts, 0);
  });

  it('laco de 515 vira falha comum depois de 3 reinicios seguidos', async () => {
    const m = montar();
    await m.gateway.start();

    for (let i = 0; i < 5; i += 1) {
      m.farm.last.emitConnection({
        connection: 'close',
        closeStatusCode: DISCONNECT.restartRequired,
      });
      await flush();
      m.scheduler.runNext();
      await flush();
    }

    assert.ok(m.gateway.status().attempts >= 2);
  });

  it('loggedOut: PARA, apaga a sessao, nao agenda reconexao e nao cria novo socket', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitConnection({ connection: 'close', closeStatusCode: DISCONNECT.loggedOut });
    await flush();

    assert.equal(m.gateway.status().state, 'stopped');
    assert.equal(m.gateway.status().stopReason, 'desvinculado');
    assert.equal(m.sessions.invalidated, 1);
    assert.equal(m.scheduler.active, 0);
    assert.equal(m.farm.sockets.length, 1);
  });

  it('connectionReplaced: PARA sem apagar a sessao (outra instancia a usa) e sem reconectar', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitConnection({
      connection: 'close',
      closeStatusCode: DISCONNECT.connectionReplaced,
    });
    await flush();

    assert.equal(m.gateway.status().stopReason, 'sessao-substituida');
    assert.equal(m.sessions.invalidated, 0);
    assert.equal(m.scheduler.active, 0);
    assert.equal(m.farm.sockets.length, 1);
  });

  it('depois de parar, eventos do socket antigo nao fazem mais nada', async () => {
    const m = montar();
    await m.abrir();
    const antigo = m.farm.last;
    antigo.emitConnection({ connection: 'close', closeStatusCode: DISCONNECT.loggedOut });
    await flush();

    antigo.emitMessages([textMessage()]);
    antigo.emitConnection({ connection: 'open' });
    await flush();

    assert.equal(m.ingest.calls.length, 0);
    assert.equal(m.gateway.status().state, 'stopped');
  });

  it('eventos do socket ANTIGO apos uma reconexao sao ignorados', async () => {
    const m = montar();
    await m.abrir();
    const antigo = m.farm.last;
    antigo.emitConnection({ connection: 'close', closeStatusCode: DISCONNECT.connectionLost });
    await flush();
    m.scheduler.runNext();
    await flush();
    m.farm.last.emitConnection({ connection: 'open' });
    await flush();

    antigo.emitMessages([textMessage({ id: 'VELHO' })]);
    await flush();

    assert.equal(m.ingest.calls.length, 0);
  });

  it('stop() cancela a reconexao agendada e fecha o socket', async () => {
    const m = montar();
    await m.abrir();
    m.farm.last.emitConnection({ connection: 'close', closeStatusCode: DISCONNECT.connectionLost });
    await flush();
    assert.equal(m.scheduler.active, 1);

    m.gateway.stop();

    assert.equal(m.scheduler.active, 0);
    assert.equal(m.gateway.status().stopReason, 'parado');
    m.scheduler.runNext();
    await flush();
    assert.equal(m.farm.sockets.length, 1);
  });

  it('creds.update salva a sessao', async () => {
    const m = montar();
    await m.abrir();

    m.farm.last.emitCreds();
    m.farm.last.emitCreds();
    await flush();

    assert.equal(m.sessions.saves, 2);
  });

  it('start() repetido nao abre uma segunda conexao', async () => {
    const m = montar();
    await m.gateway.start();
    await m.gateway.start();

    assert.equal(m.farm.sockets.length, 1);
  });
});
