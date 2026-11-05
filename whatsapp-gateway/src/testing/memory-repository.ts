import type { AuthCodec } from '../encrypted-session-store.js';
import {
  LeaseLostError,
  type SessionRepository,
  type StoredItem,
  type WriteBatch,
} from '../session-repository.js';

/**
 * "Banco" FICTICIO compartilhado: varias instancias de `MemorySessionRepository` (varios gateways) apontam para o
 * mesmo, como varios processos apontariam para o mesmo MySQL. Relogio proprio (o do banco), controlavel.
 */
export class MemoryDatabase {
  nowMs = 1_000_000;
  readonly items = new Map<string, Buffer>();
  readonly leases = new Map<string, { owner: string; until: number; generation: number }>();

  static key(sessionId: string, type: string, id: string): string {
    return `${sessionId}\u0000${type}\u0000${id}`;
  }
}

export class MemorySessionRepository implements SessionRepository {
  /** Falhas injetadas para os testes. */
  failNextWrite = false;
  failReads = false;
  failLease = false;
  /** Atraso (ms) da liberacao da trava: simula um banco lento. */
  releaseDelayMs = 0;
  writes = 0;
  closed = false;

  constructor(readonly db: MemoryDatabase = new MemoryDatabase()) {}

  acquireLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean> {
    if (this.failLease)
      return Promise.reject(new Error('banco indisponivel (host=interno user=gw)'));
    const lease = this.db.leases.get(sessionId);
    if (lease === undefined || lease.owner === owner || lease.until < this.db.nowMs) {
      this.db.leases.set(sessionId, {
        owner,
        until: this.db.nowMs + ttlMs,
        generation: (lease?.generation ?? 0) + 1,
      });
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  renewLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean> {
    if (this.failLease)
      return Promise.reject(new Error('banco indisponivel (host=interno user=gw)'));
    const lease = this.db.leases.get(sessionId);
    if (lease === undefined || lease.owner !== owner || lease.until <= this.db.nowMs) {
      return Promise.resolve(false);
    }
    lease.until = this.db.nowMs + ttlMs;
    return Promise.resolve(true);
  }

  async releaseLease(sessionId: string, owner: string): Promise<void> {
    if (this.releaseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.releaseDelayMs));
    }
    const lease = this.db.leases.get(sessionId);
    if (lease?.owner === owner) {
      lease.until = this.db.nowMs - 1;
    }
  }

  private assertLease(sessionId: string, owner: string): void {
    const lease = this.db.leases.get(sessionId);
    if (lease?.owner !== owner || lease.until <= this.db.nowMs) {
      throw new LeaseLostError();
    }
  }

  readItems(sessionId: string, type: string, ids: readonly string[]): Promise<StoredItem[]> {
    if (this.failReads) return Promise.reject(new Error('leitura falhou (SELECT ... FROM ...)'));
    const found: StoredItem[] = [];
    for (const id of ids) {
      const payload = this.db.items.get(MemoryDatabase.key(sessionId, type, id));
      if (payload !== undefined) found.push({ type, id, payload: Buffer.from(payload) });
    }
    return Promise.resolve(found);
  }

  countItems(sessionId: string): Promise<number> {
    if (this.failReads) return Promise.reject(new Error('leitura falhou'));
    const prefix = `${sessionId}\u0000`;
    return Promise.resolve([...this.db.items.keys()].filter((k) => k.startsWith(prefix)).length);
  }

  async writeBatch(sessionId: string, owner: string, batch: WriteBatch): Promise<void> {
    await Promise.resolve(); // cede o turno: torna visiveis intercalacoes indevidas
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('INSERT falhou (user=gw password=segredo)');
    }
    this.assertLease(sessionId, owner);
    // Tudo ou nada: aplica numa copia e so entao troca.
    const staged = new Map(this.db.items);
    for (const item of batch.upserts) {
      staged.set(MemoryDatabase.key(sessionId, item.type, item.id), Buffer.from(item.payload));
    }
    for (const ref of batch.deletes) {
      staged.delete(MemoryDatabase.key(sessionId, ref.type, ref.id));
    }
    this.db.items.clear();
    for (const [k, v] of staged) this.db.items.set(k, v);
    this.writes += 1;
  }

  async deleteSession(sessionId: string, owner: string): Promise<void> {
    await Promise.resolve();
    this.assertLease(sessionId, owner);
    const prefix = `${sessionId}\u0000`;
    for (const k of [...this.db.items.keys()]) {
      if (k.startsWith(prefix)) this.db.items.delete(k);
    }
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  /** Estado cru de um item (para provar que NAO esta em claro). */
  raw(sessionId: string, type: string, id: string): Buffer | undefined {
    return this.db.items.get(MemoryDatabase.key(sessionId, type, id));
  }
}

/**
 * Codec de teste: JSON com Buffer em base64 (mesma ideia do `BufferJSON`), creds FICTICIAS.
 * `SEGREDO-FICTICIO-*` e o marcador que os testes procuram no "banco" para provar que nada fica em claro.
 */
export const SECRET_MARKER = 'SEGREDO-FICTICIO-PRIVATE-KEY';

export const fakeCodec: AuthCodec = {
  newCreds: () => ({
    noiseKey: { private: Buffer.from(`${SECRET_MARKER}-noise`), public: Buffer.from('pub') },
    registrationId: 42,
    registered: false,
  }),
  // `JSON.stringify` chama `Buffer#toJSON` ANTES do replacer: o valor chega como { type: 'Buffer', data: number[] }.
  serialize: (value) =>
    JSON.stringify(value, (_k, v: unknown) => {
      const o = v as { type?: unknown; data?: unknown } | null;
      return typeof o === 'object' && o !== null && o.type === 'Buffer' && Array.isArray(o.data)
        ? { type: 'Buffer', data: Buffer.from(o.data as number[]).toString('base64') }
        : v;
    }),
  deserialize: (text) =>
    JSON.parse(text, (_k, v: unknown) => {
      if (
        typeof v === 'object' &&
        v !== null &&
        (v as { type?: unknown }).type === 'Buffer' &&
        typeof (v as { data?: unknown }).data === 'string'
      ) {
        return Buffer.from((v as { data: string }).data, 'base64');
      }
      return v;
    }) as unknown,
  reviveKey: (_type, value) => value,
};
