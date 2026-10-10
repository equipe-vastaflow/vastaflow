import { PlantaeApiError } from './plantae-errors';
import {
  MAX_CONCURRENT_REQUESTS,
  MAX_RATE_WAIT_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from './plantae.constants';

export interface RateLimiterOptions {
  readonly maxRequests?: number;
  readonly windowMs?: number;
  readonly maxConcurrent?: number;
  readonly maxWaitMs?: number;
  /** Relogio e espera injetaveis: o teste anda no tempo sem esperar de verdade. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Intervalo de re-checagem enquanto todas as vagas de concorrencia estao ocupadas. */
const CONCURRENCY_POLL_MS = 25;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Limitador LOCAL de chamadas ao Plantae.
 *
 * Tres protecoes, todas em memoria e por processo:
 * - janela deslizante: no maximo `maxRequests` por `windowMs`. O Plantae aceita
 *   60/min por chave; o padrao aqui e 50, deixando margem para qualquer outro uso
 *   da mesma chave;
 * - concorrencia: poucas requisicoes em voo ao mesmo tempo, para uma rajada de
 *   consultas nao virar uma rajada ao Plantae;
 * - pausa (`blockFor`): depois de um 429 ou de `X-RateLimit-Remaining: 0`, nada
 *   sai ate o fim da pausa.
 *
 * Quem pede uma vaga espera no maximo `maxWaitMs`. Passando disso, falha com
 * `rate-limited` e o tempo restante - nao fica pendurado indefinidamente.
 *
 * Limite: e POR PROCESSO. Com varias instancias do backend a mesma chave
 * receberia a soma delas. Hoje ha uma so (Compose, um container).
 */
export class PlantaeRateLimiter {
  private readonly stamps: number[] = [];
  private active = 0;
  private blockedUntil = 0;

  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxConcurrent: number;
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
    this.windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
    this.maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_REQUESTS;
    this.maxWaitMs = options.maxWaitMs ?? MAX_RATE_WAIT_MS;
    this.now = options.now ?? ((): number => Date.now());
    this.sleep = options.sleep ?? realSleep;
  }

  /** Para tudo ate `now + ms`. Nunca encurta uma pausa que ja existe. */
  blockFor(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(0, ms));
  }

  /**
   * Reserva uma vaga e devolve a funcao que a libera (idempotente). Quem chama
   * DEVE liberar, num `finally`.
   *
   * @throws PlantaeApiError `rate-limited` quando a espera passaria de `maxWaitMs`.
   */
  async acquire(): Promise<() => void> {
    const deadline = this.now() + this.maxWaitMs;
    for (;;) {
      const t = this.now();
      while (this.stamps.length > 0 && (this.stamps[0] ?? 0) + this.windowMs <= t) {
        this.stamps.shift();
      }
      const waitForWindow =
        this.stamps.length >= this.maxRequests ? (this.stamps[0] ?? t) + this.windowMs - t : 0;
      const waitForPause = Math.max(0, this.blockedUntil - t);
      const waitForRate = Math.max(waitForWindow, waitForPause);
      const waitForSlot = this.active >= this.maxConcurrent ? CONCURRENCY_POLL_MS : 0;
      const wait = Math.max(waitForRate, waitForSlot);

      if (wait === 0) {
        this.stamps.push(t);
        this.active += 1;
        let released = false;
        return (): void => {
          if (!released) {
            released = true;
            this.active -= 1;
          }
        };
      }
      if (t + wait > deadline) {
        throw new PlantaeApiError('rate-limited', {
          retryAfterSeconds: Math.max(1, Math.ceil(Math.max(waitForRate, wait) / 1000)),
        });
      }
      await this.sleep(wait);
    }
  }
}
