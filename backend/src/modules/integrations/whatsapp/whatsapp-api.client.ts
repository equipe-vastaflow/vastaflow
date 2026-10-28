import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PHONE_NUMBER_ID_PATTERN,
  GRAPH_VERSION_PATTERN,
  resolveGraphBase,
} from './whatsapp-settings';
import { WHATSAPP_TEXT_MAX } from './whatsapp-payload';

/** Por que o envio falhou. Categorias fixas: nada vindo da Meta nem a URL entram na mensagem. */
export type WhatsappFailure =
  'not-configured' | 'invalid-request' | 'timeout' | 'network' | 'redirect' | 'http';

export class WhatsappApiError extends Error {
  constructor(
    readonly kind: WhatsappFailure,
    readonly httpStatus?: number,
    /** `error.code` da Graph API (numero inteiro). Nunca a mensagem nem outro campo da resposta. */
    readonly graphCode?: number,
  ) {
    super(`WhatsApp falhou: ${kind}${httpStatus === undefined ? '' : ` ${String(httpStatus)}`}`);
    this.name = 'WhatsappApiError';
  }
}

export const WHATSAPP_SEND_TIMEOUT_MS = 10_000;

/** O que o processador precisa do envio (troca por falso nos testes). */
export interface WhatsappSender {
  sendText(to: string, text: string): Promise<void>;
}

/**
 * Envio de TEXTO pela Cloud API oficial (`POST /{versao}/{phone-number-id}/messages`). Unico ponto de
 * rede do modulo. So responde a quem acabou de escrever (janela de atendimento aberta pelo proprio
 * usuario): nao ha envio proativo nem template.
 *
 * Token lido na hora, pelo `ConfigService`, e usado SO no cabecalho `Authorization`; nunca em URL,
 * log ou erro. Sem redirect, com timeout, uma tentativa. Destino: Graph oficial (ou servidor de teste
 * em lista fechada de hosts).
 */
@Injectable()
export class WhatsappApiClient implements WhatsappSender {
  constructor(private readonly config: ConfigService) {}

  async sendText(to: string, text: string): Promise<void> {
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim();
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim() ?? '';
    const version = this.config.get<string>('WHATSAPP_GRAPH_API_VERSION')?.trim() ?? '';
    const base = resolveGraphBase(this.config.get<string>('WHATSAPP_API_BASE_URL'));
    if (
      !token ||
      !base.ok ||
      !PHONE_NUMBER_ID_PATTERN.test(phoneNumberId) ||
      !GRAPH_VERSION_PATTERN.test(version)
    ) {
      throw new WhatsappApiError('not-configured');
    }
    if (!/^\d{5,20}$/.test(to) || text.length < 1 || text.length > WHATSAPP_TEXT_MAX) {
      throw new WhatsappApiError('invalid-request');
    }

    const timeout = AbortSignal.timeout(WHATSAPP_SEND_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${base.base}/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: text },
        }),
        redirect: 'manual',
        signal: timeout,
      });
    } catch {
      // O erro original e descartado: pode trazer a URL.
      throw new WhatsappApiError(timeout.aborted ? 'timeout' : 'network');
    }
    if (response.status >= 300 && response.status < 400) {
      throw new WhatsappApiError('redirect', response.status);
    }
    if (!response.ok) {
      throw new WhatsappApiError('http', response.status, await readGraphErrorCode(response));
    }
  }
}

/**
 * Extrai SO o `error.code` (inteiro) do corpo de erro da Graph API, para diagnostico. O resto da
 * resposta (mensagem, `fbtrace_id`, detalhes) e descartado. Corpo ilegivel ou fora do formato: `undefined`.
 */
async function readGraphErrorCode(response: Response): Promise<number | undefined> {
  try {
    const body: unknown = await response.json();
    const error =
      typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
    const code =
      typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
    return typeof code === 'number' && Number.isSafeInteger(code) && code >= 0 ? code : undefined;
  } catch {
    return undefined;
  }
}
