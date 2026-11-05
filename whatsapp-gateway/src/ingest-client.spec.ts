import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import {
  HttpIngestClient,
  IngestError,
  MAX_RESPONSE_BYTES,
  parseIngestResponse,
} from './ingest-client.js';
import type { IngestRequest } from './ports.js';
import { ACCOUNT, SENDER } from './testing/fakes.js';

const TOKEN = `vfs_${'A'.repeat(43)}`;
const REQUEST: IngestRequest = {
  version: 1,
  messageId: 'MSG-1',
  from: SENDER,
  to: ACCOUNT,
  chatType: 'private',
  text: '/ajuda SEGREDO-NA-MENSAGEM',
  timestamp: 1_790_000_000,
};
const OK = {
  correlationId: 'evt-1',
  outcome: 'EXECUTED',
  duplicate: false,
  replyTo: SENDER,
  reply: 'Comandos disponiveis',
};

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('HttpIngestClient (servidor LOCAL, sem backend real)', () => {
  let server: http.Server;
  let baseUrl: string;
  let handler: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void;
  let last: Seen | null = null;

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        last = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        handler(req, res, last);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const client = (timeoutMs = 2000): HttpIngestClient =>
    new HttpIngestClient({ baseUrl, token: TOKEN, timeoutMs });
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const falha = async (promise: Promise<unknown>): Promise<IngestError> => {
    try {
      await promise;
    } catch (error) {
      assert.ok(error instanceof IngestError, 'erro deveria ser IngestError');
      return error;
    }
    throw new assert.AssertionError({ message: 'deveria falhar' });
  };

  it('envia POST no caminho fixo, com a credencial SO no cabecalho e o corpo do contrato', async () => {
    handler = (_req, res) => json(res, 200, OK);

    const resposta = await client().ingest(REQUEST);

    assert.deepEqual(resposta, OK);
    assert.equal(last?.method, 'POST');
    assert.equal(last?.url, '/service/whatsapp/ingest');
    assert.equal(last?.headers['x-service-token'], TOKEN);
    assert.equal(last?.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(last?.body ?? ''), REQUEST);
    assert.ok(!(last?.url ?? '').includes(TOKEN), 'token nunca na URL');
    assert.ok(!(last?.body ?? '').includes(TOKEN), 'token nunca no corpo');
  });

  it('resposta sem texto (silencio do backend): reply e replyTo nulos', async () => {
    handler = (_req, res) =>
      json(res, 200, {
        correlationId: null,
        outcome: 'UNLINKED',
        duplicate: false,
        replyTo: null,
        reply: null,
      });

    const resposta = await client().ingest(REQUEST);

    assert.equal(resposta.reply, null);
    assert.equal(resposta.replyTo, null);
  });

  for (const status of [400, 401, 403, 404, 500, 503]) {
    it(`HTTP ${String(status)}: erro tipado SEM corpo, token, URL ou texto da mensagem`, async () => {
      handler = (_req, res) => json(res, status, { message: `eco: ${REQUEST.text} ${TOKEN}` });

      const erro = await falha(client().ingest(REQUEST));

      assert.equal(erro.kind, 'http');
      assert.equal(erro.status, status);
      const exposto = `${erro.message} ${JSON.stringify(erro)} ${erro.stack ?? ''}`;
      for (const proibido of [TOKEN, 'SEGREDO-NA-MENSAGEM', '/service/whatsapp/ingest', baseUrl]) {
        assert.ok(!exposto.includes(proibido), `vazou: ${proibido}`);
      }
    });
  }

  it('NAO segue redirecionamento (o token nao pode ser desviado)', async () => {
    let seguiu = false;
    handler = (req, res) => {
      if (req.url === '/service/whatsapp/ingest') {
        res.writeHead(302, { location: '/outro' });
        res.end();
      } else {
        seguiu = true;
        json(res, 200, OK);
      }
    };

    const erro = await falha(client().ingest(REQUEST));

    assert.equal(erro.kind, 'redirect');
    assert.equal(seguiu, false);
  });

  it('timeout: erro tipado (a chamada nao fica pendurada)', async () => {
    handler = () => undefined; // nunca responde

    const erro = await falha(client(150).ingest(REQUEST));

    assert.equal(erro.kind, 'timeout');
  });

  it('servidor fora do ar: erro de rede, sem detalhe', async () => {
    const fora = new HttpIngestClient({
      baseUrl: 'http://127.0.0.1:1',
      token: TOKEN,
      timeoutMs: 1000,
    });

    const erro = await falha(fora.ingest(REQUEST));

    assert.equal(erro.kind, 'network');
    assert.ok(!erro.message.includes('127.0.0.1'));
  });

  it('resposta maior que o limite e descartada', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...OK, reply: 'x'.repeat(MAX_RESPONSE_BYTES) }));
    };

    assert.equal((await falha(client().ingest(REQUEST))).kind, 'protocol');
  });

  it('corpo que nao e JSON ou fora do contrato: erro de protocolo', async () => {
    handler = (_req, res) => res.end('<html>');
    assert.equal((await falha(client().ingest(REQUEST))).kind, 'protocol');

    handler = (_req, res) => json(res, 200, { outcome: 'EXECUTED' });
    assert.equal((await falha(client().ingest(REQUEST))).kind, 'protocol');
  });
});

describe('parseIngestResponse (contrato estrito)', () => {
  it('aceita a resposta valida', () => {
    assert.deepEqual(parseIngestResponse(OK), OK);
  });

  for (const [nome, corpo] of [
    ['nao e objeto', 'texto'],
    ['array', []],
    ['outcome ausente', { ...OK, outcome: undefined }],
    ['duplicate nao booleano', { ...OK, duplicate: 'nao' }],
    ['reply com texto mas sem destino', { ...OK, replyTo: null }],
    ['destino sem texto', { ...OK, reply: null }],
    ['reply acima de 4096', { ...OK, reply: 'x'.repeat(4097) }],
    ['replyTo enorme', { ...OK, replyTo: '1'.repeat(21) }],
    ['reply numerico', { ...OK, reply: 5 }],
  ] as const) {
    it(`recusa: ${nome}`, () => {
      assert.throws(
        () => parseIngestResponse(corpo),
        (e: unknown) => e instanceof IngestError && e.kind === 'protocol',
      );
    });
  }
});
