import type { ReadableStreamReadResult } from 'node:stream/web';
import { INGEST_PATH, TEXT_MAX } from './constants.js';
import type { IngestClient, IngestRequest, IngestResponse } from './ports.js';

/** Resposta maior que isto e descartada: o contrato real tem poucas centenas de bytes + o texto (ate 4096). */
export const MAX_RESPONSE_BYTES = 64 * 1024;

export type IngestFailure = 'timeout' | 'network' | 'http' | 'redirect' | 'protocol';

/**
 * Falha ao falar com o backend. A mensagem e FIXA e o unico detalhe e o status HTTP numerico: nunca URL, token,
 * corpo da resposta ou texto da mensagem (o objeto de erro pode ir parar em qualquer log).
 */
export class IngestError extends Error {
  constructor(
    readonly kind: IngestFailure,
    readonly status?: number,
  ) {
    super(`ingest falhou: ${kind}${status === undefined ? '' : ` ${String(status)}`}`);
    this.name = 'IngestError';
  }
}

export interface HttpIngestOptions {
  /** Origem do backend, sem caminho (validada em `config.ts`). */
  readonly baseUrl: string;
  /** Credencial de servico do principal `whatsapp-gateway`. Vai SO no cabecalho `X-Service-Token`. */
  readonly token: string;
  readonly timeoutMs: number;
  /** Injetavel para teste; padrao: `fetch` global. */
  readonly fetchFn?: typeof fetch;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function readLimited(response: Response): Promise<string | null> {
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = (await reader.read()) as ReadableStreamReadResult<Uint8Array>;
    if (result.done) {
      break;
    }
    const value = result.value;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Valida o formato da resposta; qualquer divergencia e erro de protocolo (nada de "adivinhar" um campo). */
export function parseIngestResponse(body: unknown): IngestResponse {
  if (!isRecord(body)) {
    throw new IngestError('protocol');
  }
  const { correlationId, outcome, duplicate, replyTo, reply } = body;
  const nullableString = (v: unknown, max: number): v is string | null =>
    v === null || (typeof v === 'string' && v.length <= max);
  if (
    typeof outcome !== 'string' ||
    outcome.length === 0 ||
    outcome.length > 32 ||
    typeof duplicate !== 'boolean' ||
    !nullableString(correlationId, 64) ||
    !nullableString(replyTo, 20) ||
    !nullableString(reply, TEXT_MAX)
  ) {
    throw new IngestError('protocol');
  }
  // Resposta e destino andam juntos: um sem o outro nao e uma ordem de envio valida.
  if ((reply === null) !== (replyTo === null)) {
    throw new IngestError('protocol');
  }
  return { correlationId, outcome, duplicate, replyTo, reply };
}

/**
 * Cliente HTTP do `POST /service/whatsapp/ingest`. Unico ponto de rede do gateway para o backend.
 *
 * - destino FIXO (`baseUrl` + caminho constante); nao segue redirecionamento;
 * - timeout total por chamada (`AbortSignal.timeout`); resposta limitada a 64 KiB;
 * - UMA tentativa: o backend e idempotente, mas o gateway nao reenvia sozinho (at-most-once, como o resto);
 * - o token nunca aparece em erro, log ou URL.
 */
export class HttpIngestClient implements IngestClient {
  private readonly url: string;

  constructor(private readonly options: HttpIngestOptions) {
    this.url = `${options.baseUrl}${INGEST_PATH}`;
  }

  async ingest(request: IngestRequest): Promise<IngestResponse> {
    const fetchFn = this.options.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(this.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-service-token': this.options.token,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new IngestError(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      );
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new IngestError('redirect', response.status);
    }
    if (response.status !== 200) {
      // O corpo de um erro pode repetir o que enviamos: nem e lido.
      await response.body?.cancel().catch(() => undefined);
      throw new IngestError('http', response.status);
    }

    let raw: string | null;
    try {
      raw = await readLimited(response);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new IngestError(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      );
    }
    if (raw === null) {
      throw new IngestError('protocol');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new IngestError('protocol');
    }
    return parseIngestResponse(parsed);
  }
}
