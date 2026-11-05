import { INGEST_VERSION } from './constants.js';
import type { GatewayConfig } from './config.js';
import { IngestError } from './ingest-client.js';
import type { GatewayLogger } from './logger.js';
import { classifyMessage, isVerifiedPhone, type AcceptedMessage } from './message-filter.js';
import type {
  Clock,
  ConnectionUpdate,
  IngestClient,
  MessagesBatch,
  RawWaMessage,
  Scheduler,
  SessionHandle,
  SessionStore,
  WaSocketFactory,
  WaSocketPort,
} from './ports.js';
import {
  decideReconnect,
  DEFAULT_RECONNECT,
  type ReconnectConfig,
  type StopReason,
} from './reconnect-policy.js';
import { ReplyLimiter } from './reply-limiter.js';
import { SeenIds } from './seen-ids.js';

/** Quantos reinicios (515) seguidos sao aceitos como "esperados" antes de contarem como falha. */
const MAX_RESTART_STREAK = 3;

export type GatewayState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped';

export interface GatewayStatus {
  readonly state: GatewayState;
  readonly stopReason: StopReason | null;
  /** Quedas seguidas sem conexao estavel. */
  readonly attempts: number;
  readonly counters: Readonly<Record<string, number>>;
}

export interface GatewayDeps {
  readonly socketFactory: WaSocketFactory;
  readonly sessions: SessionStore;
  readonly ingest: IngestClient;
  readonly config: Pick<
    GatewayConfig,
    'account' | 'sendTimeoutMs' | 'maxRepliesPerMinute' | 'maxQueue'
  >;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: GatewayLogger;
  readonly reconnect?: ReconnectConfig;
  readonly random?: () => number;
  /** Quanto tempo a conexao precisa durar para zerar a contagem de quedas seguidas. */
  readonly stableAfterMs?: number;
}

/**
 * Orquestra UMA conta: conecta, recebe `messages.upsert`, filtra, encaminha ao backend e responde SOMENTE o que o
 * backend autorizar, SOMENTE ao chat de origem. Nenhuma regra de negocio aqui: quem decide e o backend.
 *
 * Garantias (cada uma com teste):
 * - so `notify`; so conversa individual de texto, nova, de outra pessoa (ver `message-filter.ts`);
 * - id repetido nao e reencaminhado; o backend ainda garante a unicidade;
 * - a resposta so existe se o backend devolveu `reply` E `replyTo` igual ao remetente que NOS enviamos; o destino do
 *   envio e o chat guardado da mensagem recebida, nunca algo montado a partir da resposta;
 * - limite global de respostas; excesso descartado;
 * - mensagens processadas EM ORDEM, uma por vez, com fila limitada (excesso descartado);
 * - reconexao conforme `DisconnectReason`; `loggedOut`/`connectionReplaced` PARAM e nao voltam sozinhos;
 * - conta conectada diferente da configurada = para sem encaminhar nada;
 * - erros viram eventos de log de vocabulario fixo: nunca texto, numero, JID, token nem corpo de erro.
 */
export class Gateway {
  private state: GatewayState = 'idle';
  private stopReason: StopReason | null = null;
  private attempts = 0;
  /** Reinicios (515) seguidos: o primeiro e esperado apos o pareamento; um laco deles vira falha comum. */
  private restartStreak = 0;
  private openedAt: number | null = null;
  private generation = 0;
  private socket: WaSocketPort | null = null;
  private cancelRetry: (() => void) | null = null;
  private queue: (() => Promise<void>)[] = [];
  private draining = false;
  private readonly counters: Record<string, number> = {};
  private readonly seen = new SeenIds();
  private readonly limiter: ReplyLimiter;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly stableAfterMs: number;
  private readonly random: () => number;

  constructor(private readonly deps: GatewayDeps) {
    this.limiter = new ReplyLimiter(deps.config.maxRepliesPerMinute);
    this.reconnectConfig = deps.reconnect ?? DEFAULT_RECONNECT;
    this.stableAfterMs = deps.stableAfterMs ?? 60_000;
    this.random = deps.random ?? Math.random;
  }

  status(): GatewayStatus {
    return {
      state: this.state,
      stopReason: this.stopReason,
      attempts: this.attempts,
      counters: { ...this.counters },
    };
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      return;
    }
    this.deps.logger.event('iniciando');
    await this.connect();
  }

  /** Para de vez (pedido de quem opera). Nao apaga a sessao. */
  stop(): void {
    this.halt('parado');
  }

  private isStopped(): boolean {
    return this.state === 'stopped';
  }

  private count(name: string): void {
    this.counters[name] = (this.counters[name] ?? 0) + 1;
  }

  private async connect(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }
    this.state = 'connecting';
    this.deps.logger.event('conectando', { tentativa: this.attempts });
    let session: SessionHandle;
    try {
      session = await this.deps.sessions.open();
    } catch {
      // Sem sessao nao ha o que reconectar: parar e deixar claro (nunca girar em falso).
      this.deps.logger.event('sessao-indisponivel');
      this.halt('sessao-indisponivel');
      return;
    }
    // `stop()` pode ter sido chamado enquanto a sessao abria.
    if (this.isStopped()) {
      return;
    }
    const generation = ++this.generation;
    const socket = this.deps.socketFactory(session);
    this.socket = socket;
    socket.onConnectionUpdate((update) => {
      if (generation === this.generation) {
        void this.onConnection(update, session);
      }
    });
    socket.onMessages((batch) => {
      if (generation === this.generation) {
        this.onMessages(batch, socket);
      }
    });
    socket.onCredsUpdate(() => {
      if (generation === this.generation) {
        void session.save().catch(() => {
          this.count('falha-salvar-sessao');
        });
      }
    });
  }

  private async onConnection(update: ConnectionUpdate, _session: SessionHandle): Promise<void> {
    if (update.connection === 'open') {
      const own = this.socket?.ownNumber() ?? null;
      if (own !== this.deps.config.account) {
        // Outra conta conectada (ou conta desconhecida): nao encaminhar NADA.
        this.halt('conta-diferente');
        return;
      }
      this.state = 'open';
      this.openedAt = this.deps.clock.now();
      this.deps.logger.event('conexao-aberta');
      return;
    }
    if (update.connection !== 'close') {
      return;
    }

    const wasStable =
      this.openedAt !== null && this.deps.clock.now() - this.openedAt >= this.stableAfterMs;
    this.openedAt = null;
    if (wasStable) {
      this.attempts = 0;
      this.restartStreak = 0;
    }
    this.socket?.close();
    this.socket = null;
    this.generation += 1; // eventos do socket antigo deixam de valer
    this.deps.logger.event('conexao-fechada', { codigo: update.closeStatusCode ?? null });

    const restart = update.closeStatusCode === 515;
    this.restartStreak = restart ? this.restartStreak + 1 : 0;
    const decision = decideReconnect(
      restart && this.restartStreak > MAX_RESTART_STREAK ? null : update.closeStatusCode,
      this.attempts,
      this.reconnectConfig,
      this.random,
    );
    if (decision.action === 'stop') {
      if (decision.reason === 'desvinculado') {
        // A conta foi desvinculada: o estado salvo nao serve mais.
        await this.deps.sessions.invalidate().catch(() => {
          this.count('falha-invalidar-sessao');
        });
      }
      this.halt(decision.reason);
      return;
    }
    if (!restart || this.restartStreak > MAX_RESTART_STREAK) {
      this.attempts += 1;
    }
    this.state = 'reconnecting';
    this.deps.logger.event('reconexao-agendada', {
      atrasoMs: decision.delayMs,
      tentativa: this.attempts,
    });
    this.cancelRetry = this.deps.scheduler.after(decision.delayMs, () => {
      this.cancelRetry = null;
      void this.connect();
    });
  }

  private halt(reason: StopReason): void {
    if (this.state === 'stopped') {
      return;
    }
    this.state = 'stopped';
    this.stopReason = reason;
    this.generation += 1;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.queue = [];
    this.socket?.close();
    this.socket = null;
    this.deps.logger.event('parado', { motivo: reason });
  }

  private onMessages(batch: MessagesBatch, socket: WaSocketPort): void {
    if (batch.type !== 'notify') {
      // Historico/backfill: nunca vira comando.
      this.counters['ignorada:historico'] =
        (this.counters['ignorada:historico'] ?? 0) + batch.messages.length;
      return;
    }
    for (const raw of batch.messages) {
      if (this.queue.length >= this.deps.config.maxQueue) {
        this.count('fila-cheia');
        this.deps.logger.event('fila-cheia');
        continue;
      }
      this.queue.push(() => this.handle(raw, socket));
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      for (let task = this.queue.shift(); task !== undefined; task = this.queue.shift()) {
        await task();
      }
    } finally {
      this.draining = false;
    }
  }

  private async handle(raw: RawWaMessage, socket: WaSocketPort): Promise<void> {
    if (this.state !== 'open') {
      this.count('ignorada:fora-de-conexao');
      return;
    }
    const nowMs = this.deps.clock.now();
    const verdict = classifyMessage(raw, Math.floor(nowMs / 1000));
    if (!verdict.accepted) {
      this.count(`ignorada:${verdict.reason}`);
      this.deps.logger.event('mensagem-ignorada', { motivo: verdict.reason });
      return;
    }
    const message = verdict.message;
    // Defesa em profundidade: nada que nao seja um telefone verificado chega ao backend, qualquer que seja o caminho.
    if (!isVerifiedPhone(message.from)) {
      this.count('ignorada:telefone-nao-verificado');
      this.deps.logger.event('mensagem-ignorada', { motivo: 'telefone-nao-verificado' });
      return;
    }
    if (this.seen.check(message.messageId, nowMs)) {
      this.count('ignorada:duplicada');
      this.deps.logger.event('mensagem-ignorada', { motivo: 'duplicada' });
      return;
    }
    await this.forwardAndReply(message, socket);
  }

  private async forwardAndReply(message: AcceptedMessage, socket: WaSocketPort): Promise<void> {
    let response;
    try {
      response = await this.deps.ingest.ingest({
        version: INGEST_VERSION,
        messageId: message.messageId,
        from: message.from,
        to: this.deps.config.account,
        chatType: 'private',
        text: message.text,
        timestamp: message.timestamp,
      });
    } catch (error) {
      this.count('falha-encaminhar');
      this.deps.logger.event('falha-encaminhar', {
        tipo: error instanceof IngestError ? error.kind : 'desconhecido',
        status: error instanceof IngestError ? (error.status ?? null) : null,
      });
      return;
    }
    this.count('encaminhada');
    this.deps.logger.event('mensagem-encaminhada', {
      resultado: response.outcome,
      phoneSource: message.phoneSource,
    });

    if (response.reply === null) {
      return;
    }
    // O backend so pode mandar responder a QUEM escreveu: qualquer outro destino e ignorado.
    if (response.replyTo !== message.from) {
      this.count('resposta-destino-divergente');
      this.deps.logger.event('resposta-descartada', { motivo: 'destino-divergente' });
      return;
    }
    if (!this.limiter.tryTake(this.deps.clock.now())) {
      this.count('resposta-limite');
      this.deps.logger.event('resposta-descartada', { motivo: 'limite-global' });
      return;
    }
    await this.send(socket, message.chatJid, response.reply);
  }

  private async send(socket: WaSocketPort, chatJid: string, text: string): Promise<void> {
    try {
      await withTimeout(socket.sendText(chatJid, text), this.deps.config.sendTimeoutMs);
      this.count('respondida');
      this.deps.logger.event('resposta-enviada');
    } catch {
      this.count('falha-enviar');
      this.deps.logger.event('falha-enviar');
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('falha'));
      },
    );
  });
}
