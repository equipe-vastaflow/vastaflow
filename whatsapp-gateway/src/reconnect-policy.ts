import { DISCONNECT } from './constants.js';

/** Por que o gateway PAROU de reconectar sozinho. Vocabulario fixo (vai a logs e ao status). */
export type StopReason =
  | 'desvinculado' // loggedOut: a conta saiu do aparelho; so um novo pareamento resolve
  | 'sessao-substituida' // connectionReplaced: OUTRA instancia usa a mesma sessao; nao brigar por ela
  | 'sessao-corrompida' // badSession
  | 'acesso-negado' // forbidden: restricao/bloqueio da conta; nao insistir
  | 'versao-incompativel' // multideviceMismatch
  | 'tentativas-esgotadas'
  | 'conta-diferente' // a conta conectada nao e a configurada
  | 'sessao-indisponivel'
  | 'sessao-em-uso' // outra instancia detem a trava desta sessao
  | 'sessao-ilegivel' // chave de cifra errada, estado corrompido ou inconsistente: NUNCA recriar a sessao
  | 'trava-perdida' // a trava de instancia unica foi perdida
  | 'falha-gravar-sessao' // nao foi possivel persistir o estado com seguranca
  | 'parado'; // stop() pedido por quem opera

export type ReconnectDecision =
  | { readonly action: 'reconnect'; readonly delayMs: number }
  | { readonly action: 'stop'; readonly reason: StopReason };

export interface ReconnectConfig {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Tentativas SEGUIDAS sem conexao estavel antes de desistir. */
  readonly maxAttempts: number;
  /** Variacao aleatoria do atraso (0,2 = +-20%): evita reconectar em ritmo regular. */
  readonly jitter: number;
}

export const DEFAULT_RECONNECT: ReconnectConfig = {
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  maxAttempts: 8,
  jitter: 0.2,
};

/**
 * Decide o que fazer quando a conexao CAI. Funcao pura (o aleatorio e injetado).
 *
 * - `loggedOut` (401), `connectionReplaced` (440), `badSession` (500), `forbidden` (403), `multideviceMismatch` (411):
 *   PARA. Reconectar nao ajuda e so insiste contra a conta (ou contra outra instancia).
 * - `restartRequired` (515): esperado logo apos o pareamento; reconecta ja, sem contar como falha.
 * - Qualquer outro (queda, timeout, 503, desconhecido): backoff exponencial com jitter e limite de tentativas.
 *
 * `attempt` = quantas quedas seguidas JA ocorreram sem uma conexao estavel (0 na primeira).
 */
export function decideReconnect(
  statusCode: number | null | undefined,
  attempt: number,
  config: ReconnectConfig = DEFAULT_RECONNECT,
  random: () => number = Math.random,
): ReconnectDecision {
  switch (statusCode) {
    case DISCONNECT.loggedOut:
      return { action: 'stop', reason: 'desvinculado' };
    case DISCONNECT.connectionReplaced:
      return { action: 'stop', reason: 'sessao-substituida' };
    case DISCONNECT.badSession:
      return { action: 'stop', reason: 'sessao-corrompida' };
    case DISCONNECT.forbidden:
      return { action: 'stop', reason: 'acesso-negado' };
    case DISCONNECT.multideviceMismatch:
      return { action: 'stop', reason: 'versao-incompativel' };
    case DISCONNECT.restartRequired:
      return { action: 'reconnect', delayMs: 0 };
    default:
      break;
  }
  if (attempt >= config.maxAttempts) {
    return { action: 'stop', reason: 'tentativas-esgotadas' };
  }
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
  const spread = 1 + (random() * 2 - 1) * config.jitter;
  return { action: 'reconnect', delayMs: Math.max(0, Math.round(exponential * spread)) };
}
