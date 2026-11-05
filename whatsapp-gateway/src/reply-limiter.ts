/**
 * Limite GLOBAL de respostas por janela (padrao 20 por minuto). Protege a conta contra rajadas (um loop, um erro do
 * backend, muitos usuarios de uma vez): o excesso e DESCARTADO, nunca enfileirado para enviar depois.
 */
export class ReplyLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
  ) {}

  tryTake(nowMs: number): boolean {
    while (this.stamps.length > 0 && nowMs - (this.stamps[0] ?? 0) >= this.windowMs) {
      this.stamps.shift();
    }
    if (this.stamps.length >= this.maxPerWindow) {
      return false;
    }
    this.stamps.push(nowMs);
    return true;
  }
}
