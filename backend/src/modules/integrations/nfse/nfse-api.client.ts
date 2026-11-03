import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
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
  constructor(readonly requestMayHaveBeenProcessed: boolean) {
    super('falha de transporte com a Sefin Nacional');
    this.name = 'NfseTransportError';
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

export type NfseTransport = (request: {
  readonly method: 'GET' | 'POST';
  readonly url: URL;
  readonly body?: string;
}) => Promise<TransportResponse>;

/** Erros em que o pedido, com certeza, nao foi entregue ao servico. */
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
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
]);

/** Transporte real: HTTPS com certificado de cliente (mTLS) ou HTTP para o servidor de teste. */
export function createTransport(
  settings: Pick<NfseSettings, 'testServer' | 'caBundlePath' | 'producaoAutorizada'>,
  certificate: Pick<NfseCertificate, 'privateKeyPem' | 'certificatePem'> | null,
  timeoutMs: number = NFSE_REQUEST_TIMEOUT_MS,
): NfseTransport {
  const agent = settings.testServer
    ? undefined
    : new https.Agent({
        key: certificate?.privateKeyPem,
        cert: certificate?.certificatePem,
        ca: settings.caBundlePath === null ? undefined : readFileSync(settings.caBundlePath),
        minVersion: 'TLSv1.2',
        keepAlive: false,
      });
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
        reject(new NfseTransportError(!NEVER_DELIVERED.has(error.code ?? '')));
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
        return { kind: 'not_sent', reason: 'sem_conexao' };
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
