import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  NfseApiClient,
  NfseContractUnconfirmedError,
  NfseTransportError,
  createTransport,
  type NfseTransport,
} from './nfse-api.client';

const CHAVE = '31062002211222333000181000000000000726101234567890'.slice(0, 50);
const XML = `<NFSe><infNFSe Id="NFS${CHAVE}"></infNFSe></NFSe>`;
const OK_BODY = JSON.stringify({
  chaveAcesso: CHAVE,
  nfseXmlGZipB64: gzipSync(Buffer.from(XML)).toString('base64'),
});

describe('NFS-e - cliente da Sefin (contra servidor falso em loopback)', () => {
  let server: Server;
  let port: number;
  let handler: (request: IncomingMessage, response: ServerResponse, body: string) => void;
  const seen: Array<{ method: string; url: string; body: string; type: string | undefined }> = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        seen.push({
          method: request.method ?? '',
          url: request.url ?? '',
          body,
          type: request.headers['content-type'],
        });
        handler(request, response, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen.length = 0;
  });

  const settings = (): { baseUrl: string; testServer: true; wireContractConfirmed: false } => ({
    baseUrl: `http://127.0.0.1:${String(port)}/api`,
    testServer: true,
    wireContractConfirmed: false,
  });
  const client = (timeoutMs = 2000): NfseApiClient =>
    new NfseApiClient(
      settings(),
      createTransport({ testServer: true, caBundlePath: null }, null, timeoutMs),
    );
  const reply =
    (status: number, body: string) =>
    (_: IncomingMessage, response: ServerResponse): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    };

  it('POST /nfse envia a DPS assinada em gzip+base64 e devolve a NFS-e autorizada', async () => {
    handler = reply(201, OK_BODY);
    const outcome = await client().emit('<DPS>assinada</DPS>');
    expect(outcome).toEqual({ kind: 'authorized', chave: CHAVE, nfseXml: XML });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/nfse', type: 'application/json' });
    const sent = JSON.parse(seen[0]?.body ?? '{}') as { dpsXmlGZipB64: string };
    expect(gunzipSync(Buffer.from(sent.dpsXmlGZipB64, 'base64')).toString()).toBe(
      '<DPS>assinada</DPS>',
    );
  });

  it('rejeicao oficial vira "rejeitada"; falha 500 vira "incerta"; nunca ha segundo envio', async () => {
    handler = reply(400, JSON.stringify({ erro: [{ codigo: 'E0310', descricao: 'inexistente' }] }));
    expect((await client().emit('<DPS/>')).kind).toBe('rejected');
    expect(seen).toHaveLength(1);

    seen.length = 0;
    handler = reply(500, 'boom');
    expect((await client().emit('<DPS/>')).kind).toBe('uncertain');
    expect(seen).toHaveLength(1);
  });

  it('prazo estourado DEPOIS do envio e "incerta" (a Sefin pode ter processado)', async () => {
    handler = () => {
      // nunca responde
    };
    const outcome = await client(150).emit('<DPS/>');
    expect(outcome).toEqual({ kind: 'uncertain', reason: 'transporte_apos_envio' });
    expect(seen).toHaveLength(1);
  });

  it('conexao derrubada no meio da resposta e "incerta"', async () => {
    handler = (_request, response) => {
      response.destroy();
    };
    expect((await client().emit('<DPS/>')).kind).toBe('uncertain');
  });

  it('conexao recusada = "nao enviada" (certeza de que nao chegou)', async () => {
    const closed = new NfseApiClient(
      { baseUrl: 'http://127.0.0.1:1', testServer: true, wireContractConfirmed: false },
      createTransport({ testServer: true, caBundlePath: null }, null, 1000),
    );
    expect(await closed.emit('<DPS/>')).toEqual({ kind: 'not_sent', reason: 'sem_conexao' });
  });

  it('nao segue redirecionamento: a resposta 3xx e incerta e o destino nunca e visitado', async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:1/atacante' });
      response.end();
    };
    expect((await client().emit('<DPS/>')).kind).toBe('uncertain');
    expect(seen).toHaveLength(1);
  });

  it('resposta gigante e cortada (nao enche a memoria) e vira incerta', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('x'.repeat(9 * 1024 * 1024));
    };
    expect((await client(5000).emit('<DPS/>')).kind).toBe('uncertain');
  });

  it('consultas: GET /dps/{id} e GET /nfse/{chave} (somente leitura, sem corpo)', async () => {
    handler = (request, response) => {
      if (request.url?.startsWith('/api/dps/')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ chaveAcesso: CHAVE }));
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(OK_BODY);
      }
    };
    const api = client();
    expect(await api.findByDps('DPS123')).toEqual({ kind: 'found', chave: CHAVE });
    expect(await api.fetchNfse(CHAVE)).toEqual({ kind: 'ok', nfseXml: XML });
    expect(seen.map((item) => [item.method, item.url, item.body])).toEqual([
      ['GET', '/api/dps/DPS123', ''],
      ['GET', `/api/nfse/${CHAVE}`, ''],
    ]);
  });

  it('identificadores com caracteres especiais sao codificados na URL (sem injecao de caminho)', async () => {
    handler = reply(404, '');
    await client().findByDps('../../admin?x=1');
    expect(seen[0]?.url).toBe('/api/dps/..%2F..%2Fadmin%3Fx%3D1');
  });

  it('falha de consulta nunca lanca: vira "desconhecida"', async () => {
    const dead = new NfseApiClient(
      { baseUrl: 'http://127.0.0.1:1', testServer: true, wireContractConfirmed: false },
      createTransport({ testServer: true, caBundlePath: null }, null, 500),
    );
    expect(await dead.findByDps('DPS1')).toEqual({ kind: 'unknown' });
    expect(await dead.fetchNfse(CHAVE)).toEqual({ kind: 'unknown' });
  });
});

describe('NFS-e - portao do contrato de troca', () => {
  const spy = (): { transport: NfseTransport; calls: number } => {
    const state = { calls: 0, transport: undefined as unknown as NfseTransport };
    state.transport = () => {
      state.calls += 1;
      return Promise.resolve({ status: 500, body: '' });
    };
    return state;
  };

  it('sem NFSE_WIRE_CONTRACT_CONFIRMED a Sefin real NAO recebe nada (nem consulta)', async () => {
    const official = {
      baseUrl: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
      testServer: false,
      wireContractConfirmed: false,
    };
    const probe = spy();
    const api = new NfseApiClient(official, probe.transport);
    await expect(api.emit('<DPS/>')).rejects.toBeInstanceOf(NfseContractUnconfirmedError);
    await expect(api.findByDps('DPS1')).rejects.toBeInstanceOf(NfseContractUnconfirmedError);
    await expect(api.fetchNfse(CHAVE)).rejects.toBeInstanceOf(NfseContractUnconfirmedError);
    expect(probe.calls).toBe(0);
  });

  it('confirmado o contrato, a chamada segue ao destino oficial configurado', async () => {
    const official = {
      baseUrl: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
      testServer: false,
      wireContractConfirmed: true,
    };
    const urls: string[] = [];
    const api = new NfseApiClient(official, (request) => {
      urls.push(request.url.toString());
      return Promise.resolve({ status: 500, body: '' });
    });
    await api.emit('<DPS/>');
    expect(urls).toEqual(['https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse']);
  });

  it('erro de transporte antes do envio e distinguido do erro apos o envio', () => {
    expect(new NfseTransportError(false).requestMayHaveBeenProcessed).toBe(false);
    expect(new NfseTransportError(true).requestMayHaveBeenProcessed).toBe(true);
  });
});
