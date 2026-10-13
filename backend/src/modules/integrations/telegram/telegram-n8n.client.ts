import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasConfigValues } from '../integration-config';
import type { TelegramEnvelope } from './telegram-envelope';
import { isRecord } from './telegram-json';
import { parseN8nWebhookUrl } from './telegram-n8n-settings';

export const TELEGRAM_N8N_WEBHOOK_URL_KEY = 'TELEGRAM_N8N_WEBHOOK_URL';

/**
 * Quanto esperar o workflow. Cobre o backend avaliando (inclusive uma consulta
 * ao Plantae, que tem prazo proprio de 20 s) com folga, e ainda assim nao deixa o
 * polling parado por muito tempo.
 */
export const N8N_DELIVERY_TIMEOUT_MS = 35_000;

/** Teto da resposta do workflow: uma resposta de chat cabe em uma fracao disto. */
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Por que a entrega ao n8n falhou. Categorias fixas. */
export type TelegramRelayFailure =
  'not-configured' | 'timeout' | 'network' | 'redirect' | 'http' | 'invalid-response';

/** Falha da entrega ao n8n. Mensagem montada aqui; nada do corpo nem da URL. */
export class TelegramRelayError extends Error {
  constructor(
    readonly kind: TelegramRelayFailure,
    readonly httpStatus?: number,
  ) {
    super(
      `Entrega ao n8n falhou: ${kind}${httpStatus === undefined ? '' : ` ${String(httpStatus)}`}`,
    );
    this.name = 'TelegramRelayError';
  }
}

/**
 * Entrega um envelope assinado ao webhook do n8n e devolve o JSON de resposta.
 *
 * E o SEGUNDO (e ultimo) arquivo do modulo que chama `fetch` (o outro e o da Bot
 * API). Uma tentativa so, sem repeticao automatica: o n8n pode ate ter executado, e
 * a idempotencia do backend existe justamente para o caso de uma entrega repetida
 * - mas o transporte nao a provoca. Nao segue redirect; tem timeout e teto de
 * resposta. A URL e validada de novo aqui (so hosts da rede do Compose ou loopback).
 *
 * O texto da mensagem trafega pela rede interna, em HTTP: o webhook so e alcancavel
 * a partir da rede `automation`. Nao ha segredo na URL; a autenticidade vem da
 * assinatura DENTRO do corpo, nao do canal.
 */
@Injectable()
export class TelegramN8nClient {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return hasConfigValues(this.config, [TELEGRAM_N8N_WEBHOOK_URL_KEY]);
  }

  async deliver(envelope: TelegramEnvelope, signature: string): Promise<unknown> {
    const raw = this.config.get<string>(TELEGRAM_N8N_WEBHOOK_URL_KEY);
    const url = raw ? parseN8nWebhookUrl(raw) : null;
    if (url === null || !url.ok) {
      throw new TelegramRelayError('not-configured');
    }

    const timeout = AbortSignal.timeout(N8N_DELIVERY_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ envelope, signature }),
        redirect: 'manual',
        signal: timeout,
      });
    } catch {
      // O erro original e descartado: pode trazer a URL.
      throw new TelegramRelayError(timeout.aborted ? 'timeout' : 'network');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new TelegramRelayError('redirect', response.status);
    }
    if (response.status !== 200) {
      throw new TelegramRelayError('http', response.status);
    }
    return this.readJson(response, timeout);
  }

  private async readJson(response: Response, timeout: AbortSignal): Promise<unknown> {
    try {
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        throw new TelegramRelayError('invalid-response');
      }
      const body = response.body as AsyncIterable<Uint8Array> | null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of body ?? []) {
        total += chunk.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          throw new TelegramRelayError('invalid-response');
        }
        chunks.push(chunk);
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return isRecord(parsed) ? parsed : Promise.reject(new TelegramRelayError('invalid-response'));
    } catch (error) {
      if (error instanceof TelegramRelayError) {
        throw error;
      }
      throw new TelegramRelayError(timeout.aborted ? 'timeout' : 'invalid-response');
    }
  }
}
