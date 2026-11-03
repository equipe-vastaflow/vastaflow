import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { NfseCertificate } from './nfse-certificate';
import { NFSE_OFFICIAL_BASES, type NfseSettings } from './nfse-settings';
import {
  encodeEmissionBody,
  interpretDpsLookup,
  interpretEmissionResponse,
  interpretNfseFetch,
  type DpsLookup,
  type EmissionOutcome,
} from './nfse-wire';

export const NFSE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface TransportResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * Falha de transporte. `requestMayHaveBeenProcessed` e a pergunta que decide tudo: se a conexao nem
 * foi estabelecida (DNS, recusada, certificado nao aceito no TLS) a Sefin nunca viu o pedido; se a
 * conexao caiu ou estourou o prazo DEPOIS do envio, nao se sabe.
 */
export class NfseTransportError extends Error {
  /**
   * @param code codigo FIXO do Node/OpenSSL (ex.: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`), so para diagnostico; nunca a
   *   mensagem do erro original (que pode trazer host, caminho ou trecho de certificado).
   */
  constructor(
    readonly requestMayHaveBeenProcessed: boolean,
    readonly code: string | null = null,
  ) {
    super('falha de transporte com a Sefin Nacional');
    this.name = 'NfseTransportError';
  }
}

/**
 * Configuracao TLS invalida (ex.: o bundle de CAs nao existe ou nao tem certificado). Lancada ANTES de qualquer
 * conexao; o codigo e fixo e a mensagem nunca traz caminho nem conteudo.
 */
export class NfseTlsConfigError extends Error {
  constructor(readonly code: 'ca_bundle_ilegivel' | 'ca_bundle_invalido') {
    super(`configuracao TLS invalida: ${code}`);
    this.name = 'NfseTlsConfigError';
  }
}

export class NfseContractUnconfirmedError extends Error {
  constructor() {
    super('contrato de troca com a Sefin Nacional ainda nao confirmado');
    this.name = 'NfseContractUnconfirmedError';
  }
}

/**
 * Tentativa de falar com a Sefin de PRODUCAO sem `NFSE_PRODUCAO_AUTORIZACAO`. Lancada ANTES de qualquer conexao ou
 * envio de dado. Nunca e tratada como "incerta": nada saiu.
 */
export class NfseProductionNotAuthorizedError extends Error {
  constructor() {
    super('producao da Sefin Nacional nao autorizada');
    this.name = 'NfseProductionNotAuthorizedError';
  }
}

/** Nome do host (sem ponto final, minusculo) para comparar destinos. */
const hostOf = (url: URL): string => url.hostname.toLowerCase().replace(/\.$/, '');

/** Host da Sefin de PRODUCAO. A checagem e por DESTINO (host), nao por configuracao nem por esquema/porta. */
const PRODUCTION_HOST = hostOf(new URL(NFSE_OFFICIAL_BASES.producao));

/**
 * O destino e a Sefin de producao? Decidido pela URL FINAL (so o host), qualquer que seja o ambiente configurado,
 * o esquema (http ou https), a porta ou a caixa: nenhuma variacao de URL escapa do portao.
 */
export function isProductionUrl(url: URL): boolean {
  return hostOf(url) === PRODUCTION_HOST;
}

/** Codigos de erro do Node/OpenSSL que cabem como "motivo" de diagnostico (nunca texto livre). */
const SAFE_ERROR_CODE = /^[A-Z0-9_]{3,64}$/;
const safeCode = (code: string | undefined): string | null =>
  code !== undefined && SAFE_ERROR_CODE.test(code) ? code : null;

/**
 * Motivo (codigo fixo) de um envio que NAO saiu. Falha de TLS/certificado vira `tls_<codigo>` (ajuda a separar "servidor
 * nao confiavel", "hostname", "certificado do cliente recusado"); o resto e `sem_conexao`. Nunca texto livre.
 */
export function notSentReason(code: string | null): string {
  return code !== null && /^(ERR_SSL|ERR_TLS|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|CERT_)/.test(code)
    ? `tls_${code.toLowerCase()}`.slice(0, 40)
    : 'sem_conexao';
}

export type NfseTransport = (request: {
  readonly method: 'GET' | 'POST';
  readonly url: URL;
  readonly body?: string;
}) => Promise<TransportResponse>;

/**
 * Erros em que o pedido, com certeza, nao foi entregue ao servico: falha ao ACHAR o servidor ou ao VALIDAR um dos
 * lados na negociacao TLS (antes de qualquer dado HTTP ser processado). `ECONNRESET` e timeout NAO entram: la nao
 * se sabe.
 */
const NEVER_DELIVERED = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  // Alertas FATAIS de certificado: o servidor recusou na negociacao TLS (por exemplo, certificado de cliente
  // ausente, invalido ou expirado) e nenhum dado HTTP chegou a ser processado.
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED',
  'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE',
  'ERR_SSL_SSLV3_ALERT_UNSUPPORTED_CERTIFICATE',
  'ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED',
  'ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED',
  'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN',
]);

/** Transporte real: HTTPS com certificado de cliente (mTLS) ou HTTP para o servidor de teste. */
/**
 * Opcoes TLS do cliente mTLS, em um unico lugar (e testaveis):
 *
 * - CERTIFICADO DO CLIENTE: a folha seguida das intermediarias, em ordem e SEM a raiz (`cert` = uma cadeia por chave,
 *   como o Node documenta). Sem as intermediarias o servidor nao monta a cadeia ate a raiz que ele confia e recusa.
 * - SERVIDOR: validacao rigorosa e SEMPRE ligada (`rejectUnauthorized: true`, com a checagem de hostname padrao do
 *   Node). Nao ha configuracao que a desligue.
 * - `NFSE_CA_BUNDLE_PATH` COMPLEMENTA as CAs padrao do Node (as publicas, mais `NODE_EXTRA_CA_CERTS` e o que o
 *   Node estiver configurado a usar): `ca = padrao + bundle`. NAO as substitui. Motivo: o `ca` puro do Node
 *   SUBSTITUI o padrao, e um bundle so com a raiz da ICP-Brasil derrubaria a conexao se a cadeia do servidor
 *   mudar para uma CA publica. Sem bundle, vale so o padrao do Node.
 *
 * O bundle e lido aqui, antes de qualquer conexao. Ilegivel ou sem nenhum certificado PEM: `NfseTlsConfigError` com
 * codigo fixo (nunca o caminho nem o conteudo).
 */
export function buildHttpsAgentOptions(
  settings: Pick<NfseSettings, 'caBundlePath'>,
  certificate: Pick<NfseCertificate, 'privateKeyPem' | 'certificatePem' | 'chainPem'> | null,
): https.AgentOptions {
  let ca: string[] | undefined;
  if (settings.caBundlePath !== null) {
    let bundle: string;
    try {
      bundle = readFileSync(settings.caBundlePath, 'utf8');
    } catch {
      throw new NfseTlsConfigError('ca_bundle_ilegivel');
    }
    if (!/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.test(bundle)) {
      throw new NfseTlsConfigError('ca_bundle_invalido');
    }
    ca = [...tls.getCACertificates('default'), bundle];
  }
  return {
    key: certificate?.privateKeyPem,
    cert:
      certificate === null
        ? undefined
        : [certificate.certificatePem, ...certificate.chainPem].map((pem) => pem.trim()).join('\n'),
    ca,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    keepAlive: false,
  };
}

export function createTransport(
  settings: Pick<NfseSettings, 'testServer' | 'caBundlePath' | 'producaoAutorizada'>,
  certificate: Pick<NfseCertificate, 'privateKeyPem' | 'certificatePem' | 'chainPem'> | null,
  timeoutMs: number = NFSE_REQUEST_TIMEOUT_MS,
): NfseTransport {
  const agent = settings.testServer
    ? undefined
    : new https.Agent(buildHttpsAgentOptions(settings, certificate));
  return (request) =>
    new Promise<TransportResponse>((resolve, reject) => {
      // PORTAO DE PRODUCAO, no ultimo limite antes da rede: sem autorizacao exata, nem socket nem byte sai.
      if (isProductionUrl(request.url) && !settings.producaoAutorizada) {
        reject(new NfseProductionNotAuthorizedError());
        return;
      }
      const send = request.url.protocol === 'https:' ? https.request : http.request;
      const outgoing = send(
        request.url,
        {
          method: request.method,
          agent,
          // Sem redirecionamento: a resposta de um redirect nao e aceita (o destino e fixo).
          headers: {
            accept: 'application/json',
            ...(request.body === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(request.body),
                }),
          },
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              outgoing.destroy();
              reject(new NfseTransportError(true));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          response.on('error', () => reject(new NfseTransportError(true)));
        },
      );
      outgoing.on('timeout', () => {
        outgoing.destroy();
        reject(new NfseTransportError(true));
      });
      outgoing.on('error', (error: NodeJS.ErrnoException) => {
        reject(
          new NfseTransportError(!NEVER_DELIVERED.has(error.code ?? ''), safeCode(error.code)),
        );
      });
      outgoing.end(request.body);
    });
}

/**
 * Cliente da Sefin Nacional. Unico lugar com rede da NFS-e. Nunca registra corpo, XML, certificado
 * ou senha. O destino e fixo (ambiente configurado) e NAO ha redirecionamento.
 */
export class NfseApiClient {
  constructor(
    private readonly settings: Pick<
      NfseSettings,
      'baseUrl' | 'testServer' | 'wireContractConfirmed' | 'producaoAutorizada'
    >,
    private readonly transport: NfseTransport,
  ) {}

  /** `POST /nfse`. Uma tentativa. O chamador NUNCA repete sozinho um `uncertain`. */
  async emit(signedDpsXml: string): Promise<EmissionOutcome> {
    const url = this.url('/nfse');
    this.assertContract();
    this.assertProduction(url);
    try {
      const response = await this.transport({
        method: 'POST',
        url,
        body: encodeEmissionBody(signedDpsXml),
      });
      return interpretEmissionResponse(response.status, response.body);
    } catch (error) {
      if (error instanceof NfseProductionNotAuthorizedError) {
        throw error;
      }
      if (error instanceof NfseTransportError && !error.requestMayHaveBeenProcessed) {
        return { kind: 'not_sent', reason: notSentReason(error.code) };
      }
      return { kind: 'uncertain', reason: 'transporte_apos_envio' };
    }
  }

  /** `GET /dps/{id}`: a NFS-e gerada a partir desta DPS existe? Somente leitura. */
  async findByDps(dpsId: string): Promise<DpsLookup> {
    const url = this.url(`/dps/${encodeURIComponent(dpsId)}`);
    this.assertContract();
    this.assertProduction(url);
    try {
      const response = await this.transport({ method: 'GET', url });
      return interpretDpsLookup(response.status, response.body);
    } catch (error) {
      if (error instanceof NfseProductionNotAuthorizedError) {
        throw error;
      }
      return { kind: 'unknown' };
    }
  }

  /** `GET /nfse/{chaveAcesso}`: o XML da NFS-e. Somente leitura. */
  async fetchNfse(
    chave: string,
  ): Promise<{ readonly kind: 'ok'; readonly nfseXml: string } | { readonly kind: 'unknown' }> {
    const url = this.url(`/nfse/${encodeURIComponent(chave)}`);
    this.assertContract();
    this.assertProduction(url);
    try {
      const response = await this.transport({ method: 'GET', url });
      return interpretNfseFetch(response.status, response.body, chave);
    } catch (error) {
      if (error instanceof NfseProductionNotAuthorizedError) {
        throw error;
      }
      return { kind: 'unknown' };
    }
  }

  private url(path: string): URL {
    return new URL(`${this.settings.baseUrl}${path}`);
  }

  /**
   * Producao exige a AUTORIZACAO propria (`NFSE_PRODUCAO_AUTORIZACAO`), alem do contrato. Vale para TODA chamada
   * (emitir e consultar) cujo destino seja a Sefin de producao, antes de qualquer transporte.
   */
  private assertProduction(url: URL): void {
    if (isProductionUrl(url) && !this.settings.producaoAutorizada) {
      throw new NfseProductionNotAuthorizedError();
    }
  }

  /** Fala com a Sefin real so depois de o contrato de troca ser validado em homologacao. */
  private assertContract(): void {
    if (!this.settings.testServer && !this.settings.wireContractConfirmed) {
      throw new NfseContractUnconfirmedError();
    }
  }
}
