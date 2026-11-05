/**
 * PORTA do acesso ao banco para o estado da sessao. Tudo que passa por aqui ja chega CIFRADO: o repositorio nunca ve
 * credencial em claro. Implementacao real: `MysqlSessionRepository`; nos testes, `MemorySessionRepository`.
 *
 * TRAVA de instancia unica (uma linha por sessao, validade medida pelo RELOGIO DO BANCO, nao pelo da maquina):
 * - `acquireLease`: so toma se a trava e livre, expirou ou ja e do mesmo dono;
 * - `renewLease`: so renova se ainda e do dono E ainda nao expirou (trava expirada nao "ressuscita": quem a perdeu
 *   precisa parar);
 * - TODA escrita confere a posse da trava DENTRO da mesma transacao (`LeaseLostError` se perdida): um dono antigo nao
 *   consegue gravar depois que outro assumiu.
 */
export interface StoredItem {
  readonly type: string;
  readonly id: string;
  /** Envelope cifrado (`session-crypto.ts`). */
  readonly payload: Buffer;
}

export interface ItemRef {
  readonly type: string;
  readonly id: string;
}

export interface WriteBatch {
  readonly upserts: readonly StoredItem[];
  readonly deletes: readonly ItemRef[];
}

/** A trava de instancia unica nao pertence mais a este dono (expirou ou foi assumida). */
export class LeaseLostError extends Error {
  constructor() {
    super('trava da sessao perdida');
    this.name = 'LeaseLostError';
  }
}

export interface SessionRepository {
  acquireLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean>;
  renewLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(sessionId: string, owner: string): Promise<void>;
  readItems(sessionId: string, type: string, ids: readonly string[]): Promise<StoredItem[]>;
  countItems(sessionId: string): Promise<number>;
  /** Atomico (tudo ou nada) e sob a trava. @throws {LeaseLostError} */
  writeBatch(sessionId: string, owner: string, batch: WriteBatch): Promise<void>;
  /** Apaga SO as linhas desta sessao (nunca outras tabelas, nunca a trava). @throws {LeaseLostError} */
  deleteSession(sessionId: string, owner: string): Promise<void>;
  close(): Promise<void>;
}
