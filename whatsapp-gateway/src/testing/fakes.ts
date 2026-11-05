import type {
  Clock,
  ConnectionUpdate,
  IngestClient,
  IngestRequest,
  IngestResponse,
  MessagesBatch,
  RawWaMessage,
  Scheduler,
  SessionHandle,
  SessionStore,
  WaSocketFactory,
  WaSocketPort,
} from '../ports.js';

/** Dados 100% FICTICIOS. Nenhuma conta real, nenhum numero real. */
export const ACCOUNT = '5511900000000';
export const SENDER = '5511999990001';
export const T0_MS = 1_790_000_000_000;

export class FakeClock implements Clock {
  constructor(public ms = T0_MS) {}
  now(): number {
    return this.ms;
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

export class FakeScheduler implements Scheduler {
  readonly pending: { delayMs: number; task: () => void; cancelled: boolean }[] = [];

  after(delayMs: number, task: () => void): () => void {
    const entry = { delayMs, task, cancelled: false };
    this.pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  /** Executa a proxima tarefa agendada que nao foi cancelada. */
  runNext(): boolean {
    const entry = this.pending.shift();
    if (entry === undefined) {
      return false;
    }
    if (!entry.cancelled) {
      entry.task();
    }
    return true;
  }

  get active(): number {
    return this.pending.filter((p) => !p.cancelled).length;
  }
}

/** Socket falso: guarda os handlers e registra o que o nucleo pediu. Nunca abre rede. */
export class FakeSocket implements WaSocketPort {
  connectionHandlers: ((u: ConnectionUpdate) => void)[] = [];
  messageHandlers: ((b: MessagesBatch) => void)[] = [];
  credsHandlers: (() => void)[] = [];
  sent: { chatJid: string; text: string }[] = [];
  closed = false;
  own: string | null = ACCOUNT;
  sendImpl: (chatJid: string, text: string) => Promise<void> = () => Promise.resolve();

  onConnectionUpdate(handler: (u: ConnectionUpdate) => void): void {
    this.connectionHandlers.push(handler);
  }
  onMessages(handler: (b: MessagesBatch) => void): void {
    this.messageHandlers.push(handler);
  }
  onCredsUpdate(handler: () => void): void {
    this.credsHandlers.push(handler);
  }
  ownNumber(): string | null {
    return this.own;
  }
  async sendText(chatJid: string, text: string): Promise<void> {
    await this.sendImpl(chatJid, text);
    this.sent.push({ chatJid, text });
  }
  close(): void {
    this.closed = true;
  }

  // ---- ajudantes de teste: o "WhatsApp" falando com o nucleo ----
  emitConnection(update: ConnectionUpdate): void {
    for (const h of this.connectionHandlers) h(update);
  }
  emitMessages(messages: RawWaMessage[], type = 'notify'): void {
    for (const h of this.messageHandlers) h({ messages, type });
  }
  emitCreds(): void {
    for (const h of this.credsHandlers) h();
  }
}

export class FakeSessionStore implements SessionStore {
  opens = 0;
  saves = 0;
  invalidated = 0;
  failOpen = false;

  open(): Promise<SessionHandle> {
    this.opens += 1;
    if (this.failOpen) {
      return Promise.reject(new Error('sem sessao'));
    }
    return Promise.resolve({
      state: { creds: {}, keys: {} },
      save: () => {
        this.saves += 1;
        return Promise.resolve();
      },
    });
  }

  invalidate(): Promise<void> {
    this.invalidated += 1;
    return Promise.resolve();
  }
}

export class SocketFarm {
  readonly sockets: FakeSocket[] = [];
  readonly factory: WaSocketFactory = () => {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket;
  };
  get last(): FakeSocket {
    const socket = this.sockets[this.sockets.length - 1];
    if (socket === undefined) throw new Error('nenhum socket criado');
    return socket;
  }
}

export class FakeIngest implements IngestClient {
  calls: IngestRequest[] = [];
  /** Resposta do backend simulado. */
  respond: (request: IngestRequest) => Promise<IngestResponse> = (request) =>
    Promise.resolve({
      correlationId: 'evt-1',
      outcome: 'EXECUTED',
      duplicate: false,
      replyTo: request.from,
      reply: 'Comandos disponiveis',
    });

  ingest(request: IngestRequest): Promise<IngestResponse> {
    this.calls.push(request);
    return this.respond(request);
  }
}

/** Mensagem de texto individual valida, no formato do Baileys. */
export function textMessage(
  over: Partial<RawWaMessage> & { text?: string; id?: string } = {},
): RawWaMessage {
  const { text = '/ajuda', id = 'MSG-1', ...rest } = over;
  return {
    key: { id, remoteJid: `${SENDER}@s.whatsapp.net`, fromMe: false },
    message: { conversation: text },
    messageTimestamp: Math.floor(T0_MS / 1000),
    ...rest,
  };
}

/** Deixa a fila de microtarefas esvaziar (o nucleo processa em cadeia de promessas). */
export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}
