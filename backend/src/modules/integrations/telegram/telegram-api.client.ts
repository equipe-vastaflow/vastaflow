import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasConfigValues } from '../integration-config';
import { resolveTelegramApiBase, TELEGRAM_API_BASE_URL_KEY } from './telegram-api-base';
import { isRecord } from './telegram-json';

/** Chave do token no ambiente. O VALOR nunca sai deste arquivo. */
export const TELEGRAM_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN';

/** Limite de uma chamada comum (`getMe`, `sendMessage`). */
export const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

/** Quanto o Telegram segura um `getUpdates` sem novidade (parametro `timeout`). */
export const TELEGRAM_LONG_POLL_SECONDS = 25;

/** Limite HTTP do `getUpdates`: a espera do long polling mais uma folga. */
export const TELEGRAM_POLL_REQUEST_TIMEOUT_MS = (TELEGRAM_LONG_POLL_SECONDS + 10) * 1000;

/** Por que uma chamada falhou. Categorias fixas: nenhum texto vindo de fora. */
export type TelegramFailure =
  'not-configured' | 'timeout' | 'aborted' | 'network' | 'http' | 'invalid-response' | 'api';

/**
 * Falha de uma chamada a Bot API.
 *
 * A mensagem e montada AQUI, so com o metodo, a categoria e o status HTTP. O
 * erro original do `fetch` e descartado de proposito - e nao vai nem como
 * `cause`: a mensagem dele pode trazer a URL chamada, e a URL da Bot API
 * carrega o token (`/bot<token>/metodo`). O `description` que o Telegram
 * devolve tambem nao entra.
 */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly kind: TelegramFailure,
    readonly httpStatus?: number,
  ) {
    super(`Telegram ${method} falhou: ${kind}${httpStatus === undefined ? '' : ` ${httpStatus}`}`);
    this.name = 'TelegramApiError';
  }
}

/**
 * Cliente minimo da Telegram Bot API oficial (https://core.telegram.org/bots/api).
 *
 * Tres metodos, e so os necessarios: `getMe` (health check), `getUpdates`
 * (recebimento por long polling) e `sendMessage` (resposta). Sem SDK: o
 * `fetch` nativo do Node basta, e fica encapsulado aqui - e o unico arquivo do
 * modulo que faz chamada de rede.
 *
 * Toda chamada:
 * - le o token na hora, pelo `ConfigService`; sem token, falha ANTES de tocar a
 *   rede;
 * - tem timeout explicito (`AbortSignal.timeout`);
 * - trata erro de rede, erro HTTP, JSON invalido e `ok: false` da API;
 * - nunca registra log - quem chama decide, e so tem acesso a um erro seguro.
 */
@Injectable()
export class TelegramApiClient {
  constructor(private readonly config: ConfigService) {}

  /** Ha token configurado. So a presenca: o valor nunca e devolvido. */
  isConfigured(): boolean {
    return hasConfigValues(this.config, [TELEGRAM_TOKEN_KEY]);
  }

  /**
   * Id numerico do bot: a parte do token ANTES dos dois-pontos. Nao e segredo (e
   * publico no Telegram) e escopa o `update_id`. `null` sem token ou em formato
   * inesperado. O resto do token nunca sai daqui.
   */
  botId(): string | null {
    const id = this.config.get<string>(TELEGRAM_TOKEN_KEY)?.trim().split(':')[0];
    return id !== undefined && /^\d{1,20}$/.test(id) ? id : null;
  }

  /** Confere que o token e aceito e pertence a um bot. */
  async getMe(): Promise<void> {
    const result = await this.call('getMe', {}, TELEGRAM_REQUEST_TIMEOUT_MS);
    if (!isRecord(result) || result.is_bot !== true) {
      throw new TelegramApiError('getMe', 'invalid-response');
    }
  }

  /**
   * Long polling. `offset` confirma ao Telegram tudo o que veio antes dele.
   * `signal` permite interromper a espera no shutdown.
   *
   * Devolve os updates crus: quem os interpreta e o mapper, que valida cada um.
   */
  async getUpdates(offset: number | undefined, signal?: AbortSignal): Promise<unknown[]> {
    const result = await this.call(
      'getUpdates',
      {
        ...(offset === undefined ? {} : { offset }),
        timeout: TELEGRAM_LONG_POLL_SECONDS,
        allowed_updates: ['message'],
      },
      TELEGRAM_POLL_REQUEST_TIMEOUT_MS,
      signal,
    );
    if (!Array.isArray(result)) {
      throw new TelegramApiError('getUpdates', 'invalid-response');
    }
    return result as unknown[];
  }

  /**
   * Texto puro, sem `parse_mode`: nada do que o usuario ou o comando escreveu e
   * interpretado como marcacao pelo Telegram.
   */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text }, TELEGRAM_REQUEST_TIMEOUT_MS);
  }

  private async call(
    method: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    external?: AbortSignal,
  ): Promise<unknown> {
    const token = this.config.get<string>(TELEGRAM_TOKEN_KEY)?.trim();
    if (!token) {
      throw new TelegramApiError(method, 'not-configured');
    }

    // Base oficial, salvo o servidor de TESTE (lista fechada de hosts; ver `telegram-api-base.ts`).
    const base = resolveTelegramApiBase(this.config.get<string>(TELEGRAM_API_BASE_URL_KEY));
    if (!base.ok) {
      throw new TelegramApiError(method, 'not-configured');
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = external ? AbortSignal.any([external, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(`${base.base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      // O erro original e descartado: pode conter a URL, e a URL contem o token.
      if (external?.aborted) {
        throw new TelegramApiError(method, 'aborted');
      }
      throw new TelegramApiError(method, timeout.aborted ? 'timeout' : 'network');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TelegramApiError(
        method,
        response.ok ? 'invalid-response' : 'http',
        response.ok ? undefined : response.status,
      );
    }

    if (!response.ok) {
      throw new TelegramApiError(method, 'http', response.status);
    }
    if (!isRecord(payload) || typeof payload.ok !== 'boolean') {
      throw new TelegramApiError(method, 'invalid-response');
    }
    if (!payload.ok) {
      throw new TelegramApiError(method, 'api');
    }
    if (!('result' in payload)) {
      throw new TelegramApiError(method, 'invalid-response');
    }
    return payload.result;
  }
}
