import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SlidingWindowLimiter } from '../../../common/rate-limit/sliding-window-limiter';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { describeFailure } from './telegram.adapter';
import { TelegramApiClient, TelegramApiError } from './telegram-api.client';
import { MESSAGE_MAX_AGE_MS } from './telegram-envelope';
import { readUpdateId, toIncomingMessage } from './telegram-update.mapper';
import { TELEGRAM_UPDATE_HANDLER, type TelegramUpdateHandler } from './telegram-update-handler';

/** Espera depois da primeira falha seguida; dobra a cada nova falha. */
export const POLLING_INITIAL_BACKOFF_MS = 1_000;
/** Teto da espera entre tentativas. */
export const POLLING_MAX_BACKOFF_MS = 60_000;

/** Aviso unico (por janela) a quem excede o limite. Texto fixo. */
export const TELEGRAM_RATE_LIMIT_REPLY =
  'Voce enviou mensagens demais em pouco tempo. Aguarde cerca de um minuto e tente de novo.';

/** Janela do limite por remetente. */
export const USER_RATE_WINDOW_MS = 60_000;
/** Padrao quando a configuracao nao informa (10 mensagens por minuto). */
export const DEFAULT_USER_RATE_LIMIT = 10;

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
 * QUEM trata cada update e escolhido no boot (`TELEGRAM_UPDATE_HANDLER`): o
 * `TelegramAdapter` (modo `direct`) ou o `TelegramRelayService` (modo `n8n`). O
 * laco, o `offset` e o consumidor sao os MESMOS nos dois - trocar de modo nunca
 * cria um segundo `getUpdates`.
 *
 * Garantias do laco:
 * - UM por processo (`pollingActiveInProcess`); `start` repetido e ignorado;
 * - updates processados em sequencia, na ordem recebida;
 * - ANTES de entregar ao tratador, duas barreiras valem para os DOIS modos:
 *   1. mensagem com mais de `MESSAGE_MAX_AGE_MS` e descartada (depois de uma queda o
 *      Telegram reentrega o que ficou sem confirmar; nao se executa comando de horas
 *      atras). Sem execucao e sem resposta;
 *   2. limite POR REMETENTE (`TELEGRAM_USER_RATE_LIMIT_PER_MINUTE`): o excesso e
 *      descartado em O(1), sem n8n, sem banco, sem Plantae - uma identidade barulhenta
 *      nao atrasa as outras no laco sequencial. Um aviso fixo e enviado UMA vez por
 *      janela. O limite e por remetente: ninguem bloqueia os demais;
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
  private readonly limiter: SlidingWindowLimiter;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly client: TelegramApiClient,
    @Inject(TELEGRAM_UPDATE_HANDLER) private readonly handler: TelegramUpdateHandler,
  ) {
    const configured = Number(this.config.get('TELEGRAM_USER_RATE_LIMIT_PER_MINUTE'));
    this.limiter = new SlidingWindowLimiter(
      Number.isInteger(configured) && configured >= 1 ? configured : DEFAULT_USER_RATE_LIMIT,
      USER_RATE_WINDOW_MS,
    );
  }

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

  /**
   * `true` = descartar. Mensagens que o mapper ignora (grupo, nao-texto...) seguem para o
   * tratador, que as ignora sozinho: aqui so entram na conta as que VIRAM comando.
   */
  private async shouldSkip(raw: unknown): Promise<boolean> {
    const message = toIncomingMessage(raw);
    if (message === null) {
      return false;
    }
    if (Date.now() - message.receivedAt.getTime() > MESSAGE_MAX_AGE_MS) {
      this.logger.warn('Telegram: mensagem antiga descartada (nao executada)');
      return true;
    }
    const decision = this.limiter.take(message.sender.externalId);
    if (decision.allowed) {
      return false;
    }
    this.logger.warn('Telegram: limite por remetente excedido; mensagem descartada');
    if (decision.firstRejection) {
      try {
        await this.client.sendMessage(message.conversationId, TELEGRAM_RATE_LIMIT_REPLY);
      } catch {
        // O aviso e cortesia: falhar em envia-lo nao muda nada.
      }
    }
    return true;
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
      if (await this.shouldSkip(raw)) {
        continue;
      }
      await this.handler.handleUpdate(raw);
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
