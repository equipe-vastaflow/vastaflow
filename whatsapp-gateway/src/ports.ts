/**
 * PORTAS do gateway: tudo que o nucleo precisa do mundo externo, sem nenhuma dependencia do Baileys. O adaptador real
 * (`baileys-socket.ts`) implementa `WaSocketPort`; os testes usam um socket falso.
 */

/** Mensagem como o WhatsApp entrega, reduzida ao que o gateway le (estrutural: o `WAMessage` do Baileys cabe aqui). */
export interface RawWaMessage {
  readonly key?: {
    readonly id?: string | null;
    readonly remoteJid?: string | null;
    readonly fromMe?: boolean | null;
    readonly participant?: string | null;
    /** Na v7 do Baileys: o OUTRO formato do remetente (numero quando `remoteJid` e LID, e vice-versa). */
    readonly remoteJidAlt?: string | null;
    readonly addressingMode?: string | null;
  } | null;
  readonly message?: object | null;
  /** Segundos Unix: numero, texto ou `Long` (o gateway converte e valida). */
  readonly messageTimestamp?: unknown;
  readonly messageStubType?: unknown;
  readonly broadcast?: boolean | null;
}

export interface MessagesBatch {
  readonly messages: readonly RawWaMessage[];
  /** `notify` = recebida agora; `append` = historico. So `notify` e processada. */
  readonly type: string;
}

export interface ConnectionUpdate {
  readonly connection?: 'open' | 'connecting' | 'close';
  /** Codigo de `DisconnectReason` extraido do erro (o erro em si nunca sai do adaptador). */
  readonly closeStatusCode?: number | null;
}

/** Conexao com o WhatsApp. O QR Code e DELIBERADAMENTE ausente: o pareamento e outra etapa. */
export interface WaSocketPort {
  onConnectionUpdate(handler: (update: ConnectionUpdate) => void): void;
  onMessages(handler: (batch: MessagesBatch) => void): void;
  /** Credenciais mudaram: a sessao precisa ser salva ja. */
  onCredsUpdate(handler: () => void): void;
  /** Numero (so digitos) da propria conta, conhecido apos a conexao abrir; `null` se ainda nao se sabe. */
  ownNumber(): string | null;
  /** Envia TEXTO ao chat informado. Quem chama so passa o chat de uma mensagem que acabou de receber. */
  sendText(chatJid: string, text: string): Promise<void>;
  close(): void;
}

/** Sessao aberta: estado de autenticacao (opaco para o nucleo) e como salva-lo. */
export interface SessionHandle {
  readonly state: unknown;
  save(): Promise<void>;
}

/**
 * ARMAZENAMENTO DA SESSAO (credenciais + chaves Signal). A implementacao definitiva e da ETAPA 3 (cifrada, em tabela
 * propria, com trava de instancia unica). Aqui so existe o contrato:
 * - `open()`: devolve o estado atual (ou um vazio, para novo pareamento). Deve ser seguro contra duas instancias;
 * - `save()` do handle: chamado a cada `creds.update`, sem perder escrita;
 * - `invalidate()`: apaga a sessao (chamado em `loggedOut`: a conta foi desvinculada e o estado nao serve mais).
 */
export interface SessionStore {
  open(): Promise<SessionHandle>;
  invalidate(): Promise<void>;
}

export type WaSocketFactory = (session: SessionHandle) => WaSocketPort;

export interface IngestRequest {
  readonly version: 1;
  readonly messageId: string;
  readonly from: string;
  readonly to: string;
  readonly chatType: 'private';
  readonly text: string;
  readonly timestamp: number;
}

export interface IngestResponse {
  readonly correlationId: string | null;
  readonly outcome: string;
  readonly duplicate: boolean;
  readonly replyTo: string | null;
  readonly reply: string | null;
}

export interface IngestClient {
  ingest(request: IngestRequest): Promise<IngestResponse>;
}

export interface Clock {
  now(): number;
}

export interface Scheduler {
  /** Agenda `task` daqui a `delayMs`. Devolve como cancelar. */
  after(delayMs: number, task: () => void): () => void;
}
