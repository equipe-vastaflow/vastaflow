/**
 * Limitador de taxa por chave (janela deslizante), em memoria e LIMITADO em tamanho.
 *
 * Serve para impedir que UMA identidade monopolize um recurso (o laco do bot, a API do
 * Plantae). A chave e quem pede (ex.: id do remetente), nunca o recurso: o limite de
 * um usuario nao consome o de outro, entao ninguem consegue bloquear os demais por
 * esgotar uma cota global.
 *
 * Memoria limitada: no maximo `maxKeys` chaves; ao encher, as janelas ja vencidas
 * saem primeiro e, se ainda assim nao houver espaco, a chave mais antiga. Uma enxurrada
 * de ids falsos nao faz o mapa crescer sem limite.
 *
 * MULTIPLAS INSTANCIAS: o estado e do PROCESSO. Com N instancias o limite efetivo
 * de uma identidade e ate N vezes o configurado. No desenho atual isso nao se
 * materializa no transporte (um unico consumidor do bot por ambiente); no
 * `/contas_pagar` e uma protecao de melhor esforco - o limitador global do Plantae
 * continua valendo por instancia.
 */
export interface LimitDecision {
  readonly allowed: boolean;
  /** `true` so na PRIMEIRA recusa da janela: quem chama avisa o usuario uma vez, nao a cada mensagem. */
  readonly firstRejection: boolean;
  /** Milissegundos ate a proxima vaga (0 quando permitido). */
  readonly retryAfterMs: number;
}

interface Window {
  /** Instantes (ms) das ultimas aceitacoes, em ordem. */
  hits: number[];
  rejectedInWindow: boolean;
}

export class SlidingWindowLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = (): number => Date.now(),
  ) {
    if (!Number.isInteger(limit) || limit < 1 || windowMs < 1 || maxKeys < 1) {
      throw new RangeError('SlidingWindowLimiter: parametros invalidos');
    }
  }

  /** Registra uma tentativa de `key` e diz se passa. */
  take(key: string): LimitDecision {
    const now = this.now();
    const window = this.windows.get(key) ?? { hits: [], rejectedInWindow: false };
    // Reinsere para manter a ordem de uso (a mais antiga fica primeiro no Map).
    this.windows.delete(key);

    window.hits = window.hits.filter((hit) => now - hit < this.windowMs);
    if (window.hits.length === 0) {
      window.rejectedInWindow = false;
    }

    let decision: LimitDecision;
    if (window.hits.length < this.limit) {
      window.hits.push(now);
      decision = { allowed: true, firstRejection: false, retryAfterMs: 0 };
    } else {
      const first = !window.rejectedInWindow;
      window.rejectedInWindow = true;
      decision = {
        allowed: false,
        firstRejection: first,
        retryAfterMs: Math.max(0, (window.hits[0] ?? now) + this.windowMs - now),
      };
    }

    this.makeRoom();
    this.windows.set(key, window);
    return decision;
  }

  /** Quantas chaves estao guardadas (para teste e observabilidade). */
  size(): number {
    return this.windows.size;
  }

  private makeRoom(): void {
    if (this.windows.size < this.maxKeys) {
      return;
    }
    const now = this.now();
    for (const [key, window] of this.windows) {
      if (window.hits.every((hit) => now - hit >= this.windowMs)) {
        this.windows.delete(key);
      }
    }
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) {
        return;
      }
      this.windows.delete(oldest.value);
    }
  }
}
