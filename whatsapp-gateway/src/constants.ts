/** Limite do texto aceito pelo backend (`WHATSAPP_TEXT_MAX`): acima disso o backend responde 400. */
export const TEXT_MAX = 4096;

/** Mensagem mais velha que isto nao e encaminhada (o backend aplica o mesmo limite: 10 min). */
export const MESSAGE_MAX_AGE_SECONDS = 600;

/** Tolerancia de relogio para mensagens "do futuro" (o backend aplica o mesmo limite: 5 min). */
export const MESSAGE_MAX_FUTURE_SKEW_SECONDS = 300;

/** Versao do contrato `POST /service/whatsapp/ingest`. */
export const INGEST_VERSION = 1;

/** Caminho FIXO do backend: nada que venha de fora escolhe o destino. */
export const INGEST_PATH = '/service/whatsapp/ingest';

/**
 * Codigos de `DisconnectReason` do Baileys usados na politica de reconexao. Ficam aqui (e nao importados) para que
 * o nucleo nao dependa da biblioteca; `baileys-constants.spec.ts` confere que sao IGUAIS aos da versao instalada.
 */
export const DISCONNECT = {
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  timedOut: 408,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  multideviceMismatch: 411,
  forbidden: 403,
  unavailableService: 503,
} as const;
