'use strict';

/**
 * Bot API do Telegram FALSA, so para teste local. Sem dependencia (so `node:http`).
 *
 * Implementa o MINIMO que o `TelegramApiClient` usa:
 *   POST /bot<token>/getMe
 *   POST /bot<token>/getUpdates   { offset, timeout, allowed_updates }
 *   POST /bot<token>/sendMessage  { chat_id, text }
 * com o mesmo envelope `{ ok, result }` / `{ ok:false, error_code, description }` da API real.
 *
 * Comportamentos copiados da Bot API que o cliente e o polling dependem:
 * - `offset` CONFIRMA: updates com `update_id < offset` saem da fila;
 * - long polling: sem novidade, a resposta espera ate `timeout` segundos (limitado a 25);
 * - DOIS `getUpdates` simultaneos: o mais antigo e encerrado com 409 (como no Telegram) e o
 *   conflito e contado - e assim que se prova que NAO ha consumidor concorrente.
 *
 * Controle (so para o teste; mesma porta, nunca exposta fora da rede do teste):
 *   POST /__control/enqueue  { update } | { updates: [...] }   enfileira updates
 *   GET  /__control/sent                                        o que o bot "enviou"
 *   GET  /__control/state                                       contadores
 *   POST /__control/redeliver { update_id }                     re-entrega um update ja visto
 *   POST /__control/reset                                       zera enviados/contadores/fila
 *
 * Dados 100% ficticios. Nunca chama a internet e NUNCA registra corpo de mensagem em log.
 */

const http = require('node:http');

const LONG_POLL_MAX_SECONDS = 25;

function startFakeBotApi({ port = 0, host = '0.0.0.0', token, log = () => undefined } = {}) {
  /** @type {Array<Record<string, unknown> & { update_id: number }>} */
  let updates = [];
  /** Todo update ja enfileirado, por id: permite RE-ENTREGAR (o que o Telegram faz apos uma queda). */
  const history = new Map();
  let nextUpdateId = 1;
  let nextMessageId = 1;
  /** @type {Array<{ chat_id: string; text: string; at: string }>} */
  let sent = [];
  let counters = { getUpdatesCalls: 0, conflicts: 0, sendMessageCalls: 0, rejectedToken: 0 };
  /** @type {null | { respond: (status: number, body: unknown) => void; done: boolean }} */
  let pending = null;
  /** @type {Set<() => void>} */
  const waiters = new Set();

  const wake = () => {
    for (const w of [...waiters]) {
      w();
    }
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 1_000_000) {
          reject(new Error('corpo grande demais'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw === '' ? {} : JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  const send = (res, status, body) => {
    if (res.writableEnded) {
      return;
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const apiError = (res, status, description) =>
    send(res, status, { ok: false, error_code: status, description });

  async function getUpdates(res, body) {
    counters.getUpdatesCalls += 1;
    if (pending !== null && !pending.done) {
      // Como o Telegram: o getUpdates anterior e encerrado com 409.
      counters.conflicts += 1;
      pending.respond(409, {
        ok: false,
        error_code: 409,
        description: 'Conflict: terminated by other getUpdates request',
      });
    }
    if (Number.isInteger(body.offset)) {
      updates = updates.filter((u) => u.update_id >= body.offset);
    }
    if (updates.length > 0) {
      send(res, 200, { ok: true, result: updates });
      return;
    }
    const seconds = Math.min(Math.max(Number(body.timeout) || 0, 0), LONG_POLL_MAX_SECONDS);
    if (seconds === 0) {
      send(res, 200, { ok: true, result: [] });
      return;
    }
    await new Promise((resolve) => {
      const me = {
        done: false,
        respond: (status, payload) => {
          if (me.done) {
            return;
          }
          me.done = true;
          waiters.delete(check);
          clearTimeout(timer);
          if (pending === me) {
            pending = null;
          }
          send(res, status, payload);
          resolve(undefined);
        },
      };
      const check = () => {
        if (updates.length > 0) {
          me.respond(200, { ok: true, result: updates });
        }
      };
      const timer = setTimeout(() => me.respond(200, { ok: true, result: [] }), seconds * 1000);
      res.on('close', () => me.respond(499, { ok: false }));
      waiters.add(check);
      pending = me;
    });
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://fake');
        const path = url.pathname;

        if (path.startsWith('/__control/')) {
          if (path === '/__control/enqueue' && req.method === 'POST') {
            const body = await readBody(req);
            const list = Array.isArray(body.updates) ? body.updates : [body.update];
            for (const item of list) {
              const update = { ...item };
              if (!Number.isInteger(update.update_id)) {
                update.update_id = nextUpdateId;
              }
              nextUpdateId = Math.max(nextUpdateId, update.update_id) + 1;
              history.set(update.update_id, update);
              updates.push(update);
            }
            wake();
            send(res, 200, { ok: true, queued: list.length });
          } else if (path === '/__control/redeliver' && req.method === 'POST') {
            const body = await readBody(req);
            const original = history.get(body.update_id);
            if (original === undefined) {
              apiError(res, 404, 'Not Found');
            } else {
              updates.push({ ...original });
              wake();
              send(res, 200, { ok: true });
            }
          } else if (path === '/__control/sent' && req.method === 'GET') {
            send(res, 200, { ok: true, sent });
          } else if (path === '/__control/state' && req.method === 'GET') {
            send(res, 200, { ok: true, ...counters, queued: updates.length, sent: sent.length });
          } else if (path === '/__control/reset' && req.method === 'POST') {
            updates = [];
            history.clear();
            sent = [];
            counters = { getUpdatesCalls: 0, conflicts: 0, sendMessageCalls: 0, rejectedToken: 0 };
            send(res, 200, { ok: true });
          } else {
            apiError(res, 404, 'Not Found');
          }
          return;
        }

        const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(path);
        if (!match || req.method !== 'POST') {
          apiError(res, 404, 'Not Found');
          return;
        }
        if (token !== undefined && decodeURIComponent(match[1]) !== token) {
          counters.rejectedToken += 1;
          apiError(res, 401, 'Unauthorized');
          return;
        }
        const body = await readBody(req);
        switch (match[2]) {
          case 'getMe':
            send(res, 200, {
              ok: true,
              result: {
                id: Number(String(match[1]).split(':')[0]) || 1,
                is_bot: true,
                first_name: 'Bot Ficticio',
                username: 'bot_ficticio_bot',
              },
            });
            break;
          case 'getUpdates':
            await getUpdates(res, body);
            break;
          case 'sendMessage': {
            counters.sendMessageCalls += 1;
            if (typeof body.text !== 'string' || body.text === '' || body.chat_id === undefined) {
              apiError(res, 400, 'Bad Request: chat_id and text are required');
              break;
            }
            sent.push({
              chat_id: String(body.chat_id),
              text: body.text,
              at: new Date().toISOString(),
            });
            send(res, 200, {
              ok: true,
              result: {
                message_id: nextMessageId++,
                chat: { id: Number(body.chat_id) },
                text: body.text,
              },
            });
            break;
          }
          default:
            apiError(res, 404, 'Not Found');
        }
      } catch {
        apiError(res, 400, 'Bad Request');
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      log(`fake-telegram: ouvindo na porta ${String(actualPort)}`);
      resolve({
        port: actualPort,
        close: () =>
          new Promise((done) => {
            if (pending !== null) {
              pending.respond(200, { ok: true, result: [] });
            }
            server.closeAllConnections();
            server.close(() => done(undefined));
          }),
      });
    });
  });
}

module.exports = { startFakeBotApi };

if (require.main === module) {
  const port = Number(process.env.FAKE_TELEGRAM_PORT || 8081);
  const token = process.env.FAKE_TELEGRAM_TOKEN || undefined;
  startFakeBotApi({ port, token, log: (line) => process.stdout.write(`${line}\n`) }).catch(() => {
    process.stderr.write('fake-telegram: falha ao iniciar\n');
    process.exit(1);
  });
}
