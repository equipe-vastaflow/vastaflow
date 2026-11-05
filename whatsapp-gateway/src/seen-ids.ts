/**
 * Primeira barreira contra reentrega do MESMO id (o WhatsApp retransmite ao reconectar). So em memoria e so para
 * poupar chamadas: quem garante a unicidade e o backend (indice unico em `whatsapp_inbound_events`).
 */
export class SeenIds {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly maxEntries = 5000,
    private readonly ttlMs = 60 * 60_000,
  ) {}

  /** `true` se o id JA foi visto (e dentro do prazo); caso contrario registra e devolve `false`. */
  check(id: string, nowMs: number): boolean {
    const at = this.seen.get(id);
    if (at !== undefined && nowMs - at <= this.ttlMs) {
      return true;
    }
    this.seen.delete(id);
    this.seen.set(id, nowMs);
    this.evict(nowMs);
    return false;
  }

  get size(): number {
    return this.seen.size;
  }

  private evict(nowMs: number): void {
    for (const [id, at] of this.seen) {
      if (nowMs - at > this.ttlMs || this.seen.size > this.maxEntries) {
        this.seen.delete(id);
      } else {
        break;
      }
    }
  }
}
