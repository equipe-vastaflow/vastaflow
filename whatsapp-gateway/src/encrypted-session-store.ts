import type { Scheduler, SessionHandle, SessionStore } from './ports.js';
import { SessionUnavailableError } from './ports.js';
import type { StopReason } from './reconnect-policy.js';
import { SessionCipher } from './session-crypto.js';
import { LeaseLostError, type SessionRepository, type StoredItem } from './session-repository.js';

/**
 * Como o estado do Baileys vira texto e volta. A implementacao real (`baileys-auth-codec.ts`) usa o `BufferJSON` e o
 * `initAuthCreds` da biblioteca; os testes usam um codec proprio com Buffer. Fica fora daqui para o armazenamento
 * nao depender do Baileys.
 */
export interface AuthCodec {
  /** Credenciais NOVAS (sessao que nunca existiu). */
  newCreds(): unknown;
  serialize(value: unknown): string;
  deserialize(text: string): unknown;
  /** Devolve a chave no formato que o Baileys espera (ex.: `app-state-sync-key` vira mensagem protobuf). */
  reviveKey(type: string, value: unknown): unknown;
}

export interface EncryptedStoreOptions {
  readonly repository: SessionRepository;
  readonly cipher: SessionCipher;
  readonly codec: AuthCodec;
  readonly scheduler: Scheduler;
  /** Identificador da sessao (letras minusculas, digitos e hifen). */
  readonly sessionId: string;
  /** Identificador unico DESTA instancia (a trava e dela). Aleatorio a cada processo. */
  readonly owner: string;
  /** Validade da trava (padrao 30 s). */
  readonly leaseTtlMs?: number;
  /** Intervalo da renovacao (padrao 10 s). */
  readonly renewEveryMs?: number;
}

const CREDS_TYPE = 'creds';
const CREDS_ID = '-';
const TYPE_FORMAT = /^[a-z0-9-]{1,64}$/;
const MAX_ID_LENGTH = 255;
/** Renovacoes com ERRO (banco indisponivel) toleradas em sequencia antes de assumir a trava como perdida. */
const MAX_RENEW_ERRORS = 2;

/** Fila FIFO: escritas do estado nunca se intercalam nem se perdem, mesmo com eventos simultaneos do Baileys. */
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Armazenamento PERSISTENTE, CIFRADO e de INSTANCIA UNICA do estado de autenticacao do WhatsApp.
 *
 * - **Cifra:** cada item (`creds` e cada chave Signal) vira um envelope AES-256-GCM ligado ao seu contexto
 *   (sessao, tipo, id). O banco nunca ve credencial em claro.
 * - **Trava:** `open()` toma a trava da sessao; um heartbeat a renova; escrever sem a trava e impossivel (o repositorio
 *   confere a posse na mesma transacao). Perdeu a trava = `onFatal('trava-perdida')`.
 * - **Escritas:** todas passam por UMA fila (ordem preservada); `creds` usa a fotografia MAIS RECENTE no momento de
 *   gravar e junta pedidos repetidos; as chaves vao em lote atomico.
 * - **Falha fechada:** chave errada, dado corrompido ou estado inconsistente => `onFatal('sessao-ilegivel')`, e a
 *   sessao NUNCA e recriada por cima (isso apagaria uma sessao valida por um erro de configuracao). Falha de escrita =>
 *   `onFatal('falha-gravar-sessao')`: continuar usando chaves que nao foram persistidas corromperia a sessao.
 * - Erros do banco/driver nunca sobem como estao (podem citar host, usuario ou SQL): viram mensagens fixas.
 *
 * Depois de um erro fatal o objeto fica INUTILIZAVEL: o processo precisa reiniciar.
 */
export class EncryptedSessionStore implements SessionStore {
  private held = false;
  private failed: StopReason | null = null;
  private readonly fatalHandlers: ((reason: StopReason) => void)[] = [];
  private readonly queue = new SerialQueue();
  private cancelRenew: (() => void) | null = null;
  private renewErrors = 0;
  private creds: unknown = null;
  private credsPending: Promise<void> | null = null;
  /** Liberacao da trava disparada por um erro fatal: `close()` a AGUARDA (o processo nao pode sair antes dela). */
  private releasePending: Promise<void> | null = null;
  private readonly leaseTtlMs: number;
  private readonly renewEveryMs: number;

  constructor(private readonly o: EncryptedStoreOptions) {
    this.leaseTtlMs = o.leaseTtlMs ?? 30_000;
    this.renewEveryMs = o.renewEveryMs ?? 10_000;
  }

  onFatal(handler: (reason: StopReason) => void): void {
    this.fatalHandlers.push(handler);
  }

  /** Motivo do erro fatal, se houve (para diagnostico em testes e no log de parada). */
  get fatalReason(): StopReason | null {
    return this.failed;
  }

  // ---------------------------------------------------------------- abrir

  async open(): Promise<SessionHandle> {
    await this.ensureLease();
    const creds = await this.loadOrCreateCreds();
    this.creds = creds;
    return {
      state: { creds, keys: this.keyStore() },
      save: () => this.saveCreds(),
    };
  }

  /** Confere trava, chave e dados SEM criar nada: `vazia` = sessao ainda nao pareada. */
  async verify(): Promise<'vazia' | 'valida'> {
    await this.ensureLease();
    const rows = await this.read(CREDS_TYPE, [CREDS_ID]);
    const row = rows[0];
    if (row === undefined) {
      if ((await this.count()) > 0) {
        throw this.poison('sessao-ilegivel');
      }
      return 'vazia';
    }
    this.decode(row);
    return 'valida';
  }

  private async loadOrCreateCreds(): Promise<unknown> {
    const rows = await this.read(CREDS_TYPE, [CREDS_ID]);
    const row = rows[0];
    if (row !== undefined) {
      return this.decode(row);
    }
    // Sem credenciais mas COM outras linhas = estado inconsistente: nunca "completar" por cima.
    if ((await this.count()) > 0) {
      throw this.poison('sessao-ilegivel');
    }
    const created = this.o.codec.newCreds();
    await this.writeCreds(created);
    return created;
  }

  // ---------------------------------------------------------------- trava

  private async ensureLease(): Promise<void> {
    if (this.failed !== null) {
      throw new SessionUnavailableError(this.failed);
    }
    if (!this.held) {
      let acquired: boolean;
      try {
        acquired = await this.o.repository.acquireLease(
          this.o.sessionId,
          this.o.owner,
          this.leaseTtlMs,
        );
      } catch {
        throw new SessionUnavailableError('sessao-indisponivel');
      }
      if (!acquired) {
        throw new SessionUnavailableError('sessao-em-uso');
      }
      this.held = true;
      this.renewErrors = 0;
      this.scheduleRenew();
      return;
    }
    let renewed: boolean;
    try {
      renewed = await this.o.repository.renewLease(this.o.sessionId, this.o.owner, this.leaseTtlMs);
    } catch {
      throw new SessionUnavailableError('sessao-indisponivel');
    }
    if (!renewed) {
      throw this.poison('trava-perdida');
    }
  }

  private scheduleRenew(): void {
    this.cancelRenew = this.o.scheduler.after(this.renewEveryMs, () => {
      void this.renew();
    });
  }

  private async renew(): Promise<void> {
    if (!this.held || this.failed !== null) {
      return;
    }
    try {
      const renewed = await this.o.repository.renewLease(
        this.o.sessionId,
        this.o.owner,
        this.leaseTtlMs,
      );
      if (!renewed) {
        this.poison('trava-perdida');
        return;
      }
      this.renewErrors = 0;
    } catch {
      this.renewErrors += 1;
      if (this.renewErrors >= MAX_RENEW_ERRORS) {
        this.poison('trava-perdida');
        return;
      }
    }
    if (this.held && this.failed === null) {
      this.scheduleRenew();
    }
  }

  // ---------------------------------------------------------------- falha fechada

  /** Marca o armazenamento como inutilizavel, avisa o gateway (uma vez) e devolve o erro para quem lancou. */
  private poison(reason: StopReason): SessionUnavailableError {
    if (this.failed === null) {
      this.failed = reason;
      this.cancelRenew?.();
      this.cancelRenew = null;
      if (this.held && reason !== 'trava-perdida') {
        // Libera a trava para que uma instancia saudavel possa assumir (se a trava foi perdida, nao e mais nossa).
        this.releasePending = this.o.repository
          .releaseLease(this.o.sessionId, this.o.owner)
          .catch(() => undefined);
      }
      this.held = false;
      for (const handler of this.fatalHandlers) {
        try {
          handler(reason);
        } catch {
          // Quem escuta nunca pode impedir a parada.
        }
      }
    }
    return new SessionUnavailableError(this.failed ?? reason);
  }

  private assertUsable(): void {
    if (this.failed !== null) {
      throw new Error('sessao encerrada');
    }
  }

  // ---------------------------------------------------------------- leitura

  private ctx(type: string, id: string): { sessionId: string; type: string; id: string } {
    return { sessionId: this.o.sessionId, type, id };
  }

  private async read(type: string, ids: readonly string[]): Promise<StoredItem[]> {
    this.assertUsable();
    try {
      return await this.o.repository.readItems(this.o.sessionId, type, ids);
    } catch {
      throw new SessionUnavailableError('sessao-indisponivel');
    }
  }

  private async count(): Promise<number> {
    try {
      return await this.o.repository.countItems(this.o.sessionId);
    } catch {
      throw new SessionUnavailableError('sessao-indisponivel');
    }
  }

  /** Decifra e desserializa UM item. Qualquer falha = estado ilegivel (fatal): chave errada ou adulteracao. */
  private decode(item: StoredItem): unknown {
    try {
      const text = this.o.cipher.decrypt(item.payload, this.ctx(item.type, item.id));
      return this.o.codec.deserialize(text);
    } catch {
      throw this.poison('sessao-ilegivel');
    }
  }

  private keyStore(): {
    get: (type: string, ids: string[]) => Promise<Record<string, unknown>>;
    set: (data: Record<string, Record<string, unknown> | undefined>) => Promise<void>;
  } {
    return {
      get: async (type, ids) => {
        const result: Record<string, unknown> = {};
        if (ids.length === 0) {
          return result;
        }
        for (const item of await this.read(type, ids)) {
          result[item.id] = this.o.codec.reviveKey(type, this.decode(item));
        }
        return result;
      },
      set: (data) => this.setKeys(data),
    };
  }

  // ---------------------------------------------------------------- escrita

  /** Roda uma escrita na fila; qualquer erro vira fatal e uma mensagem FIXA (nunca o erro do driver). */
  private async write(task: () => Promise<void>): Promise<void> {
    try {
      await this.queue.run(async () => {
        this.assertUsable();
        await task();
      });
    } catch (error) {
      if (this.failed === null) {
        this.poison(error instanceof LeaseLostError ? 'trava-perdida' : 'falha-gravar-sessao');
      }
      // Sem `cause` DE PROPOSITO: o erro do driver pode citar host, usuario ou SQL e nao pode ir a log nem a stack.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('falha ao gravar o estado da sessao');
    }
  }

  private async setKeys(data: Record<string, Record<string, unknown> | undefined>): Promise<void> {
    const upserts: StoredItem[] = [];
    const deletes: { type: string; id: string }[] = [];
    for (const [type, entries] of Object.entries(data)) {
      for (const [id, value] of Object.entries(entries ?? {})) {
        if (
          !TYPE_FORMAT.test(type) ||
          id.length === 0 ||
          id.length > MAX_ID_LENGTH ||
          type === CREDS_TYPE
        ) {
          this.poison('falha-gravar-sessao');
          throw new Error('falha ao gravar o estado da sessao');
        }
        if (value === null || value === undefined) {
          deletes.push({ type, id });
        } else {
          upserts.push({ type, id, payload: this.seal(type, id, value) });
        }
      }
    }
    if (upserts.length === 0 && deletes.length === 0) {
      return;
    }
    await this.write(() =>
      this.o.repository.writeBatch(this.o.sessionId, this.o.owner, { upserts, deletes }),
    );
  }

  private seal(type: string, id: string, value: unknown): Buffer {
    try {
      return this.o.cipher.encrypt(this.o.codec.serialize(value), this.ctx(type, id));
    } catch {
      this.poison('falha-gravar-sessao');
      throw new Error('falha ao gravar o estado da sessao');
    }
  }

  private writeCreds(creds: unknown): Promise<void> {
    return this.write(async () => {
      const payload = this.seal(CREDS_TYPE, CREDS_ID, creds);
      await this.o.repository.writeBatch(this.o.sessionId, this.o.owner, {
        upserts: [{ type: CREDS_TYPE, id: CREDS_ID, payload }],
        deletes: [],
      });
    });
  }

  /**
   * `creds.update`: grava as credenciais MAIS RECENTES. Pedidos que chegam enquanto outro ainda nao comecou sao
   * juntados; um pedido durante a gravacao gera uma nova gravacao depois dela (nada se perde, nada fica velho).
   */
  private saveCreds(): Promise<void> {
    if (this.credsPending !== null) {
      return this.credsPending;
    }
    const pending = this.write(async () => {
      this.credsPending = null;
      if (!isRecord(this.creds)) {
        throw new Error('sem credenciais');
      }
      const payload = this.seal(CREDS_TYPE, CREDS_ID, this.creds);
      await this.o.repository.writeBatch(this.o.sessionId, this.o.owner, {
        upserts: [{ type: CREDS_TYPE, id: CREDS_ID, payload }],
        deletes: [],
      });
    });
    this.credsPending = pending;
    // Quem nao aguardar (o evento do Baileys) nao pode gerar rejeicao nao tratada; o fatal ja foi sinalizado.
    pending.catch(() => undefined);
    return pending;
  }

  // ---------------------------------------------------------------- encerrar

  /** `loggedOut`: apaga SO as linhas desta sessao. Outras tabelas, outras sessoes e a configuracao ficam intactas. */
  async invalidate(): Promise<void> {
    await this.ensureLease();
    await this.write(() => this.o.repository.deleteSession(this.o.sessionId, this.o.owner));
    this.creds = null;
  }

  /** Para a renovacao, espera as escritas pendentes e solta a trava. Idempotente. */
  async close(): Promise<void> {
    this.cancelRenew?.();
    this.cancelRenew = null;
    await this.queue.idle();
    await this.releasePending;
    if (this.held) {
      this.held = false;
      await this.o.repository.releaseLease(this.o.sessionId, this.o.owner).catch(() => undefined);
    }
  }
}
