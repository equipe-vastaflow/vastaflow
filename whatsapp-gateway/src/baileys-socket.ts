import makeWASocket, {
  Browsers,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidDecode,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import type { ConnectionUpdate, MessagesBatch, WaSocketFactory, WaSocketPort } from './ports.js';

/**
 * UNICO arquivo que importa o Baileys. Adapta o socket real a `WaSocketPort`.
 *
 * Decisoes (cada uma reduz exposicao ou risco para a conta):
 * - logger do Baileys SILENCIOSO: a biblioteca registra JIDs, trechos de protocolo e erros com dados; nada disso sai;
 * - sem historico (`syncFullHistory: false`, `shouldSyncHistoryMessage` sempre falso) e sem `markOnlineOnConnect`
 *   (o celular continua recebendo as notificacoes);
 * - o QR Code NAO e repassado: o pareamento e uma etapa propria (CLI administrativa); aqui um QR e simplesmente
 *   ignorado, entao este adaptador nunca exibe nem registra um codigo de login;
 * - grupos, broadcasts, status e newsletters sao ignorados ja na biblioteca (`shouldIgnoreJid`);
 * - nenhum envio proativo: `sendText` existe, mas so o nucleo o chama, e apenas para o chat de uma mensagem recebida.
 */

interface SilentLogger {
  level: string;
  child(obj: Record<string, unknown>): SilentLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const noop = (): void => undefined;
const silentLogger: SilentLogger = {
  level: 'silent',
  child: () => silentLogger,
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** O estado de autenticacao que o armazenamento entrega e opaco para o nucleo; aqui ele e conferido. */
function asAuthState(state: unknown): AuthenticationState {
  if (!isRecord(state) || !isRecord(state.creds) || !isRecord(state.keys)) {
    throw new Error('estado de sessao invalido');
  }
  return state as unknown as AuthenticationState;
}

/** `ConnectionState.lastDisconnect.error` do Baileys e um `Boom`: so o codigo numerico sai daqui. */
function closeStatusCode(update: { lastDisconnect?: { error?: unknown } }): number | null {
  const error = update.lastDisconnect?.error;
  if (isRecord(error) && isRecord(error.output) && typeof error.output.statusCode === 'number') {
    return error.output.statusCode;
  }
  return null;
}

/** Digitos de um JID de telefone (`5511...:12@s.whatsapp.net`), ou `null` se nao for desse tipo. */
function phoneDigits(jid: unknown): string | null {
  if (typeof jid !== 'string') {
    return null;
  }
  const decoded = jidDecode(jid);
  return decoded?.server === 's.whatsapp.net' && /^\d{5,20}$/.test(decoded.user)
    ? decoded.user
    : null;
}

export function createBaileysSocketFactory(): WaSocketFactory {
  return (session): WaSocketPort => {
    const auth = asAuthState(session.state);
    const sock = makeWASocket({
      auth,
      logger: silentLogger,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) =>
        isJidGroup(jid) === true ||
        isJidBroadcast(jid) === true ||
        isJidStatusBroadcast(jid) === true ||
        isJidNewsletter(jid) === true,
      getMessage: () => Promise.resolve(undefined),
    });

    return {
      onConnectionUpdate(handler: (update: ConnectionUpdate) => void): void {
        sock.ev.on('connection.update', (update) => {
          // Deliberadamente sem `qr`: nada de codigo de login passa daqui.
          handler({
            ...(update.connection === undefined ? {} : { connection: update.connection }),
            closeStatusCode: closeStatusCode(update),
          });
        });
      },
      onMessages(handler: (batch: MessagesBatch) => void): void {
        sock.ev.on('messages.upsert', ({ messages, type }) => {
          handler({ messages, type });
        });
      },
      onCredsUpdate(handler: () => void): void {
        sock.ev.on('creds.update', () => {
          handler();
        });
      },
      ownNumber(): string | null {
        const user = sock.user;
        return phoneDigits(user?.phoneNumber) ?? phoneDigits(user?.id);
      },
      async sendText(chatJid: string, text: string): Promise<void> {
        await sock.sendMessage(chatJid, { text });
      },
      close(): void {
        // Encerrar nunca deve derrubar o gateway: o resultado (promessa ou nao) e ignorado de proposito.
        void Promise.resolve(sock.end(undefined)).catch(() => undefined);
      },
    };
  };
}
