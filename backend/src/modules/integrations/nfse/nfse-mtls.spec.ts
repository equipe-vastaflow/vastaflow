import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { inspect } from 'node:util';
import { issue, toPfx, type Issued } from '../../../../test/support/tls-test-pki';
import {
  NfseApiClient,
  NfseTlsConfigError,
  NfseTransportError,
  buildHttpsAgentOptions,
  createTransport,
  notSentReason,
} from './nfse-api.client';
import { openPfx, type NfseCertificate } from './nfse-certificate';

/**
 * mTLS de ponta a ponta contra um servidor HTTPS LOCAL que exige certificado de cliente. Tudo FICTICIO: autoridades e
 * certificados gerados em memoria. Nenhum acesso a API do governo, nenhum certificado real.
 *
 * Cadeia do cliente:   Raiz -> Intermediaria 1 -> Intermediaria 2 -> folha do cliente
 * Cadeia do servidor:  Raiz -> Intermediaria 1 -> folha do servidor (SAN 127.0.0.1)
 * O servidor CONFIA SO na Raiz: so autentica um cliente que apresente a cadeia completa ate ela.
 */
jest.setTimeout(60_000);

const PFX_PASSWORD = 'senha-ficticia-do-teste-mtls';

interface Pki {
  root: Issued;
  int1: Issued;
  int2: Issued;
  client: Issued;
  expiredClient: Issued;
  rogueClient: Issued;
  rogueRoot: Issued;
  server: Issued;
  wrongHostServer: Issued;
  selfSignedServer: Issued;
}

function buildPki(): Pki {
  const root = issue({ cn: 'Raiz Ficticia', ca: true });
  const int1 = issue({ cn: 'Intermediaria 1 Ficticia', ca: true, issuer: root });
  const int2 = issue({ cn: 'Intermediaria 2 Ficticia', ca: true, issuer: int1 });
  const rogueRoot = issue({ cn: 'Raiz Falsa', ca: true });
  return {
    root,
    int1,
    int2,
    client: issue({ cn: 'Cliente Ficticio', usage: 'client', issuer: int2 }),
    expiredClient: issue({
      cn: 'Cliente Expirado',
      usage: 'client',
      issuer: int2,
      notBefore: new Date('2020-01-01T00:00:00Z'),
      notAfter: new Date('2021-01-01T00:00:00Z'),
    }),
    rogueClient: issue({ cn: 'Cliente Falso', usage: 'client', issuer: rogueRoot }),
    rogueRoot,
    server: issue({ cn: 'Servidor Ficticio', usage: 'server', issuer: int1, ips: ['127.0.0.1'] }),
    wrongHostServer: issue({
      cn: 'Servidor de Outro Host',
      usage: 'server',
      issuer: int1,
      dns: ['outro.example'],
    }),
    selfSignedServer: issue({ cn: 'Servidor Autoassinado', usage: 'server', ips: ['127.0.0.1'] }),
  };
}

interface Running {
  readonly url: string;
  readonly seen: { cn: string | null; authorized: boolean }[];
  close(): Promise<void>;
}

function startServer(options: {
  readonly leaf: Issued;
  readonly chain: readonly Issued[];
  readonly trustedClientCas: readonly Issued[];
}): Promise<Running> {
  const seen: Running['seen'] = [];
  const server = https.createServer(
    {
      key: options.leaf.keyPem,
      cert: [options.leaf, ...options.chain].map((item) => item.certPem).join(''),
      ca: options.trustedClientCas.map((item) => item.certPem),
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    (request, response) => {
      const peer = (request.socket as tls.TLSSocket).getPeerCertificate();
      seen.push({
        cn: typeof peer.subject?.CN === 'string' ? peer.subject.CN : null,
        authorized: (request.socket as tls.TLSSocket).authorized,
      });
      request.resume();
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end('{}');
    },
  );
  server.on('tlsClientError', () => undefined);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `https://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
        seen,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

describe('NFS-e - mTLS contra servidor HTTPS local (PKI ficticia)', () => {
  let pki: Pki;
  let dir: string;
  let bundlePath: string;
  let rogueBundlePath: string;
  const running: Running[] = [];
  const secrets: string[] = [];

  beforeAll(() => {
    pki = buildPki();
    dir = mkdtempSync(join(tmpdir(), 'vastaflow-mtls-'));
    bundlePath = join(dir, 'cas-ficticias.pem');
    rogueBundlePath = join(dir, 'cas-outra-raiz.pem');
    writeFileSync(bundlePath, pki.root.certPem);
    writeFileSync(rogueBundlePath, pki.rogueRoot.certPem);
    // Material que NUNCA pode aparecer em mensagem de erro, log ou arquivo.
    secrets.push(
      PFX_PASSWORD,
      dir,
      pki.client.keyPem.split('\n')[2] ?? 'x',
      pki.client.keyPem.split('\n')[3] ?? 'x',
    );
  });

  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()));
  });

  /** Servidor local que exige mTLS e confia so na Raiz. */
  async function server(
    leaf: Issued = pki.server,
    chain: readonly Issued[] = [pki.int1],
  ): Promise<Running> {
    const started = await startServer({ leaf, chain, trustedClientCas: [pki.root] });
    running.push(started);
    return started;
  }

  /** Abre o `.pfx` como o servico faz: o certificado e a cadeia vem de `openPfx`, nunca montados a mao. */
  function certificateFrom(leaf: Issued, others: readonly Issued[]): NfseCertificate {
    return openPfx(toPfx(leaf, others, PFX_PASSWORD), PFX_PASSWORD, new Date());
  }

  const send = (
    url: string,
    certificate: NfseCertificate | null,
    caBundlePath: string | null = bundlePath,
  ): Promise<{ status: number; body: string }> =>
    createTransport(
      { testServer: false, caBundlePath, producaoAutorizada: false },
      certificate,
      5000,
    )({
      method: 'POST',
      url: new URL(`${url}/nfse`),
      body: '{}',
    });

  const failure = async (promise: Promise<unknown>): Promise<NfseTransportError> => {
    const error: unknown = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NfseTransportError);
    return error as NfseTransportError;
  };

  describe('cadeia do certificado do cliente (chainPem)', () => {
    it('chainPem sai ORDENADA (emissor da folha primeiro), sem a folha, SEM a raiz e sem certificado alheio', () => {
      const unrelated = issue({ cn: 'Sem Relacao Com a Cadeia', ca: true });
      // Ordem propositalmente embaralhada dentro do .pfx.
      const certificate = certificateFrom(pki.client, [unrelated, pki.root, pki.int1, pki.int2]);

      expect(certificate.chainPem).toEqual([pki.int2.certPem, pki.int1.certPem]);
      expect(certificate.chainPem.join('')).not.toContain(pki.root.certPem);
      expect(certificate.chainPem.join('')).not.toContain(unrelated.certPem);
      expect(certificate.certificatePem).toBe(pki.client.certPem);
    });

    it('pfx so com a folha: cadeia vazia; folha emitida direto pela raiz: tambem vazia (raiz nunca entra)', () => {
      expect(certificateFrom(pki.client, []).chainPem).toEqual([]);
      const direct = issue({ cn: 'Direto da Raiz', usage: 'client', issuer: pki.root });
      expect(certificateFrom(direct, [pki.root]).chainPem).toEqual([]);
    });

    it('elo sem assinatura valida nao entra (a cadeia e verificada pela ASSINATURA, nao so pelo nome)', () => {
      // Mesmo nome da Intermediaria 2, mas chave e assinatura de outra raiz: nao e quem emitiu a folha.
      const impostor = issue({ cn: 'Intermediaria 2 Ficticia', ca: true, issuer: pki.rogueRoot });
      const certificate = certificateFrom(pki.client, [impostor, pki.int2, pki.int1]);

      expect(certificate.chainPem).toEqual([pki.int2.certPem, pki.int1.certPem]);
    });

    it('as opcoes do agente apresentam a folha seguida das intermediarias, em ordem, sem a raiz', () => {
      const certificate = certificateFrom(pki.client, [pki.root, pki.int1, pki.int2]);

      const options = buildHttpsAgentOptions({ caBundlePath: null }, certificate);

      expect(options.cert).toBe(
        [pki.client.certPem, pki.int2.certPem, pki.int1.certPem]
          .map((pem) => pem.trim())
          .join('\n'),
      );
      expect(String(options.cert)).not.toContain(pki.root.certPem.trim());
      expect(options.key).toBe(certificate.privateKeyPem);
    });
  });

  describe('autenticacao do cliente pelo servidor', () => {
    it('CADEIA VALIDA (folha + intermediarias): o servidor autentica o cliente e a requisicao e atendida', async () => {
      const s = await server();

      const response = await send(s.url, certificateFrom(pki.client, [pki.int1, pki.int2]));

      expect(response.status).toBe(201);
      expect(s.seen).toEqual([{ cn: 'Cliente Ficticio', authorized: true }]);
    });

    it('cadeia INCOMPLETA (so a folha): o servidor recusa', async () => {
      const s = await server();
      const certificate = { ...certificateFrom(pki.client, [pki.int1, pki.int2]), chainPem: [] };

      const error = await failure(send(s.url, certificate));

      expect(error).toBeInstanceOf(NfseTransportError);
      expect(s.seen).toEqual([]);
    });

    it('cadeia INCOMPLETA (falta uma intermediaria): o servidor recusa', async () => {
      const s = await server();
      const certificate = {
        ...certificateFrom(pki.client, [pki.int1, pki.int2]),
        chainPem: [pki.int2.certPem],
      };

      await failure(send(s.url, certificate));

      expect(s.seen).toEqual([]);
    });

    it('certificado AUSENTE (sem certificado de cliente): o servidor recusa; o alerta de certificado e "nao enviada"', async () => {
      const s = await server();

      const error = await failure(send(s.url, null));

      expect(s.seen).toEqual([]);
      if (error.code === 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED') {
        expect(error.requestMayHaveBeenProcessed).toBe(false);
      }
    });

    it('certificado INVALIDO (emitido por outra autoridade): o servidor recusa', async () => {
      const s = await server();
      const certificate = certificateFrom(pki.rogueClient, [pki.rogueRoot]);

      await failure(send(s.url, certificate));

      expect(s.seen).toEqual([]);
    });

    it('certificado de cliente EXPIRADO: o servidor recusa', async () => {
      const s = await server();
      // `openPfx` ja recusaria um expirado; aqui o certificado chega ao TLS para provar a recusa do SERVIDOR.
      const expired = {
        privateKeyPem: pki.expiredClient.keyPem,
        certificatePem: pki.expiredClient.certPem,
        chainPem: [pki.int2.certPem, pki.int1.certPem],
      } as unknown as NfseCertificate;

      await failure(send(s.url, expired));

      expect(s.seen).toEqual([]);
    });

    it('chave privada que nao e a do certificado: o handshake falha (sem enviar nada)', async () => {
      const s = await server();
      const certificate = {
        ...certificateFrom(pki.client, [pki.int1, pki.int2]),
        privateKeyPem: pki.rogueClient.keyPem,
      };

      await expect(send(s.url, certificate)).rejects.toBeDefined();
      expect(s.seen).toEqual([]);
    });
  });

  describe('validacao rigorosa do servidor', () => {
    const certificate = (): NfseCertificate => certificateFrom(pki.client, [pki.int1, pki.int2]);

    it('hostname INCORRETO (certificado do servidor para outro nome): o cliente recusa e nao envia nada', async () => {
      const s = await server(pki.wrongHostServer);

      const error = await failure(send(s.url, certificate()));

      expect(error.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      expect(error.requestMayHaveBeenProcessed).toBe(false);
      expect(s.seen).toEqual([]);
    });

    it('servidor de CA desconhecida (sem bundle): o cliente recusa', async () => {
      const s = await server();

      const error = await failure(send(s.url, certificate(), null));

      expect(error.code).toBe('UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
      expect(error.requestMayHaveBeenProcessed).toBe(false);
      expect(s.seen).toEqual([]);
    });

    it('servidor autoassinado, mesmo com bundle da Raiz: o cliente recusa (autoassinado nao esta no bundle)', async () => {
      const s = await server(pki.selfSignedServer, []);

      const error = await failure(send(s.url, certificate(), bundlePath));

      expect(error.requestMayHaveBeenProcessed).toBe(false);
      expect(s.seen).toEqual([]);
    });

    it('bundle de OUTRA raiz: o servidor nao e aceito (o bundle nao confia em tudo, so no que contem)', async () => {
      const s = await server();

      const error = await failure(send(s.url, certificate(), rogueBundlePath));

      expect(error.requestMayHaveBeenProcessed).toBe(false);
      expect(s.seen).toEqual([]);
    });

    it('servidor que NAO envia a intermediaria (cadeia incompleta do servidor): o cliente recusa', async () => {
      const s = await server(pki.server, []);

      const error = await failure(send(s.url, certificate()));

      expect(error.requestMayHaveBeenProcessed).toBe(false);
      expect(s.seen).toEqual([]);
    });

    it('nao existe caminho para desligar a validacao: rejectUnauthorized e sempre true', () => {
      for (const caBundlePath of [null, bundlePath]) {
        expect(buildHttpsAgentOptions({ caBundlePath }, null).rejectUnauthorized).toBe(true);
      }
      const fonte = readFileSync(join(__dirname, 'nfse-api.client.ts'), 'utf8');
      expect(fonte).not.toMatch(
        /rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity/,
      );
    });
  });

  describe('NFSE_CA_BUNDLE_PATH: complementa as CAs padrao do Node, nao as substitui', () => {
    it('sem bundle: vale so o padrao do Node (nenhum `ca` explicito) e o servidor ficticio e recusado', async () => {
      expect(buildHttpsAgentOptions({ caBundlePath: null }, null).ca).toBeUndefined();
      const s = await server();

      const error = await failure(
        send(s.url, certificateFrom(pki.client, [pki.int1, pki.int2]), null),
      );

      expect(error.code).toBe('UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
    });

    it('com bundle: `ca` = TODAS as CAs padrao + o conteudo do bundle (nada do padrao se perde)', () => {
      const ca = buildHttpsAgentOptions({ caBundlePath: bundlePath }, null).ca as string[];
      const defaults = tls.getCACertificates('default');

      expect(defaults.length).toBeGreaterThan(50);
      expect(ca).toHaveLength(defaults.length + 1);
      expect(ca.slice(0, defaults.length)).toEqual(defaults);
      expect(ca[defaults.length]).toBe(pki.root.certPem);
    });

    it('com bundle da Raiz: o servidor ficticio e aceito (cadeia completa do cliente e do servidor)', async () => {
      const s = await server();

      const response = await send(
        s.url,
        certificateFrom(pki.client, [pki.int1, pki.int2]),
        bundlePath,
      );

      expect(response.status).toBe(201);
    });

    it('bundle com varias CAs (inclusive uma que nao e a do servidor): a do servidor continua valendo', async () => {
      const both = join(dir, 'duas-cas.pem');
      writeFileSync(both, `${pki.rogueRoot.certPem}\n${pki.root.certPem}`);
      const s = await server();

      const response = await send(s.url, certificateFrom(pki.client, [pki.int1, pki.int2]), both);

      expect(response.status).toBe(201);
    });

    it.each([
      ['inexistente', () => join(dir, 'nao-existe.pem'), 'ca_bundle_ilegivel'],
      ['sem nenhum certificado PEM', () => writeBundle('texto qualquer'), 'ca_bundle_invalido'],
      ['so com chave privada', () => writeBundle(pki.client.keyPem), 'ca_bundle_invalido'],
    ])(
      'bundle %s: recusado ANTES de qualquer conexao, com codigo fixo e sem o caminho',
      (_nome, path, code) => {
        const bundle = path();
        let error: unknown;
        try {
          buildHttpsAgentOptions({ caBundlePath: bundle }, null);
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(NfseTlsConfigError);
        expect((error as NfseTlsConfigError).code).toBe(code);
        expect(String((error as Error).message)).not.toContain(bundle);
        expect(() =>
          createTransport(
            { testServer: false, caBundlePath: bundle, producaoAutorizada: false },
            null,
          ),
        ).toThrow(NfseTlsConfigError);
      },
    );

    function writeBundle(content: string): string {
      const path = join(dir, `bundle-${String(Math.random()).slice(2, 8)}.pem`);
      writeFileSync(path, content);
      return path;
    }
  });

  describe('classificacao: o que a Sefin nunca viu vira "nao enviada", com o motivo em codigo fixo', () => {
    const api = (
      url: string,
      certificate: NfseCertificate | null,
      caBundlePath: string | null,
    ): NfseApiClient =>
      new NfseApiClient(
        { baseUrl: url, testServer: false, wireContractConfirmed: true, producaoAutorizada: false },
        createTransport(
          { testServer: false, caBundlePath, producaoAutorizada: false },
          certificate,
          5000,
        ),
      );

    it('hostname errado: nao enviada, motivo tls_err_tls_cert_altname_invalid', async () => {
      const s = await server(pki.wrongHostServer);

      expect(
        await api(s.url, certificateFrom(pki.client, [pki.int1, pki.int2]), bundlePath).emit(
          '<DPS/>',
        ),
      ).toEqual({
        kind: 'not_sent',
        reason: 'tls_err_tls_cert_altname_invalid',
      });
    });

    it('servidor nao confiavel: nao enviada, motivo tls_unable_to_get_issuer_cert_locally', async () => {
      const s = await server();

      expect(
        await api(s.url, certificateFrom(pki.client, [pki.int1, pki.int2]), null).emit('<DPS/>'),
      ).toEqual({
        kind: 'not_sent',
        reason: 'tls_unable_to_get_issuer_cert_locally',
      });
    });

    it('cadeia valida: autorizada pelo servidor local (emit chega e a resposta e interpretada)', async () => {
      const s = await server();

      const outcome = await api(
        s.url,
        certificateFrom(pki.client, [pki.int1, pki.int2]),
        bundlePath,
      ).emit('<DPS/>');

      // O servidor local responde 201 com corpo vazio: sem chave nem XML, a resposta nunca e dada como emitida.
      expect(outcome).toEqual({ kind: 'uncertain', reason: 'sucesso_sem_chave_ou_xml_valido' });
      expect(s.seen).toHaveLength(1);
    });

    it('motivos: so codigos de TLS viram tls_*; o resto e sem_conexao; nada de texto livre', () => {
      expect(notSentReason('ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED')).toBe(
        'tls_err_ssl_tlsv13_alert_certificate_required'.slice(0, 40),
      );
      expect(notSentReason('ECONNREFUSED')).toBe('sem_conexao');
      expect(notSentReason(null)).toBe('sem_conexao');
      expect(notSentReason('ERR_SSL_' + 'X'.repeat(80)).length).toBeLessThanOrEqual(40);
    });
  });

  describe('nenhum segredo vaza em erro, log ou arquivo versionado', () => {
    it('erros de TLS (servidor, cliente, bundle) nao carregam chave, certificado, senha nem caminhos', async () => {
      const logs: unknown[][] = [];
      const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
        jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logs.push(args);
        }),
      );
      const collected: unknown[] = [];
      try {
        const s = await server();
        const wrong = await server(pki.wrongHostServer);
        const good = certificateFrom(pki.client, [pki.int1, pki.int2]);
        for (const attempt of [
          () => send(s.url, null),
          () => send(s.url, { ...good, chainPem: [] }),
          () => send(s.url, certificateFrom(pki.rogueClient, [pki.rogueRoot])),
          () => send(s.url, good, null),
          () => send(wrong.url, good),
        ]) {
          collected.push(
            await attempt().then(
              () => undefined,
              (e: unknown) => e,
            ),
          );
        }
        try {
          buildHttpsAgentOptions({ caBundlePath: join(dir, 'nao-existe.pem') }, good);
        } catch (e) {
          collected.push(e);
        }
        try {
          openPfx(toPfx(pki.client, [], PFX_PASSWORD), 'senha-errada');
        } catch (e) {
          collected.push(e);
        }
      } finally {
        for (const spy of spies) {
          spy.mockRestore();
        }
      }

      expect(collected.filter((item) => item !== undefined)).toHaveLength(7);
      const text = collected
        .map(
          (item) =>
            `${inspect(item, { depth: 6 })} ${JSON.stringify(item)} ${String((item as Error).stack)}`,
        )
        .join('\n');
      for (const secret of secrets) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)|\.pem|\.pfx/);
      expect(logs).toEqual([]);
    });

    it('as mensagens dos erros sao fixas e nao dependem do que o Node reportou', async () => {
      const s = await server();

      const error = await failure(send(s.url, null));

      expect(error.message).toBe('falha de transporte com a Sefin Nacional');
      expect(error.code === null || /^[A-Z0-9_]+$/.test(error.code)).toBe(true);
    });

    it('nenhum arquivo versionado ou a versionar traz chave privada, certificado, .pfx ou senha de certificado', () => {
      const raiz = join(__dirname, '..', '..', '..', '..', '..');
      const git = (...args: string[]): string[] =>
        execFileSync('git', ['-C', raiz, ...args], { encoding: 'utf8' })
          .split('\n')
          .filter((linha) => linha !== '');
      // O que seria commitado: rastreado + novo nao ignorado.
      const arquivos = [...git('ls-files'), ...git('ls-files', '--others', '--exclude-standard')];

      expect(arquivos.length).toBeGreaterThan(100);
      expect(
        arquivos.filter((arquivo) => /\.(pfx|p12|pem|key|crt|cer|jks)$/i.test(arquivo)),
      ).toEqual([]);
      const comChave: string[] = [];
      for (const arquivo of arquivos) {
        const caminho = join(raiz, arquivo);
        let tamanho: number;
        try {
          const info = statSync(caminho);
          if (!info.isFile()) {
            continue;
          }
          tamanho = info.size;
        } catch {
          continue;
        }
        if (tamanho > 2_000_000 || /\.(png|jpg|ico|woff2?|zip|tar|gz)$/i.test(arquivo)) {
          continue;
        }
        if (
          /-----BEGIN [A-Z ]*PRIVATE KEY-----\s+[A-Za-z0-9+/=]{40,}/.test(
            readFileSync(caminho, 'latin1'),
          )
        ) {
          comChave.push(arquivo);
        }
      }
      expect(comChave).toEqual([]);
      expect(readdirSync(raiz)).not.toContain('node_modules.bak');
    });
  });
});
