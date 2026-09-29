import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { describeFailure, TelegramAdapter } from './telegram.adapter';
import { TelegramApiClient, TelegramApiError } from './telegram-api.client';
import { readUpdateId } from './telegram-update.mapper';

/** Espera depois da primeira falha seguida; dobra a cada nova falha. */
export const POLLING_INITIAL_BACKOFF_MS = 1_000;
/** Teto da espera entre tentativas. */
export const POLLING_MAX_BACKOFF_MS = 60_000;

/**
 * O polling ativo NESTE processo. Um so, mesmo que a aplicacao seja montada
 * duas vezes (como nos testes e2e): dois `getUpdates` simultaneos para o mesmo
 * bot se atrapalham, e o Telegram recusa um deles.
 */
let pollingActiveInProcess = false;

/**
 * Recebimento de mensagens por long polling (`getUpdates`).
 *
 * Escolhido em vez de webhook porque roda em qualquer maquina, sem URL
 * publica, certificado nem configuracao externa - e nenhuma rota HTTP nova e
 * aberta na aplicacao.
 *
 * OPT-IN: so inicia com `TELEGRAM_POLLING_ENABLED=true` E token configurado.
 * Sem isso a aplicacao sobe normalmente e nada e chamado. O boot nunca espera o
 * Telegram: o laco roda em segundo plano, e uma falha dele e so um log.
 *
 * Garantias do laco:
 * - UM por processo (`pollingActiveInProcess`); `start` repetido e ignorado;
 * - updates processados em sequencia, na ordem recebida;
 * - `offset` avanca ANTES de processar cada update: um update que quebre nao
 *   volta em toda consulta;
 * - falha (rede, HTTP, resposta invalida) espera com backoff exponencial de 1s
 *   a 60s antes de tentar de novo - nunca um laco apertado. Um lote nao vazio
 *   sem nenhum `update_id` valido conta como falha pelo mesmo motivo;
 * - `stop` interrompe a espera em curso (inclusive o long polling) e so resolve
 *   quando o laco terminou: nenhum timer fica aberto no shutdown.
 */
@Injectable()
export class TelegramPollingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramPollingService.name);
  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private offset: number | undefined;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly client: TelegramApiClient,
    private readonly adapter: TelegramAdapter,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('TELEGRAM_POLLING_ENABLED', { infer: true })) {
      return;
    }
    if (!this.client.isConfigured()) {
      this.logger.warn(
        'Telegram: polling habilitado, mas TELEGRAM_BOT_TOKEN ausente; nao iniciado',
      );
      return;
    }
    this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  isRunning(): boolean {
    return this.loop !== null;
  }

  /** @returns `false` se ja ha polling neste processo ou se falta o token. */
  start(): boolean {
    if (this.loop !== null || pollingActiveInProcess || !this.client.isConfigured()) {
      return false;
    }
    pollingActiveInProcess = true;
    this.controller = new AbortController();
    this.loop = this.run(this.controller.signal);
    this.logger.log('Telegram: polling iniciado');
    return true;
  }

  async stop(): Promise<void> {
    if (this.loop === null || this.controller === null) {
      return;
    }
    this.controller.abort();
    await this.loop;
    this.loop = null;
    this.controller = null;
    // So o dono do laco chega aqui (so ele tem `loop`), entao libera o processo.
    pollingActiveInProcess = false;
    this.logger.log('Telegram: polling encerrado');
  }

  private async run(signal: AbortSignal): Promise<void> {
    let backoff = POLLING_INITIAL_BACKOFF_MS;

    while (!signal.aborted) {
      try {
        const updates = await this.client.getUpdates(this.offset, signal);
        await this.process(updates, signal);
        backoff = POLLING_INITIAL_BACKOFF_MS;
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        this.logger.warn(
          `Telegram: falha no polling (${describeFailure(error)}); ` +
            `nova tentativa em ${backoff / 1000}s`,
        );
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, POLLING_MAX_BACKOFF_MS);
      }
    }
  }

  private async process(updates: readonly unknown[], signal: AbortSignal): Promise<void> {
    let advanced = false;
    for (const raw of updates) {
      if (signal.aborted) {
        return;
      }
      const updateId = readUpdateId(raw);
      if (updateId !== null && (this.offset === undefined || updateId >= this.offset)) {
        this.offset = updateId + 1;
        advanced = true;
      }
      await this.adapter.handleUpdate(raw);
    }
    if (updates.length > 0 && !advanced) {
      // Sem avancar o offset, o mesmo lote voltaria na hora: laco apertado.
      throw new TelegramApiError('getUpdates', 'invalid-response');
    }
  }
}

/** Espera interrompivel: o `abort` do sinal encerra na hora e limpa o timer. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
