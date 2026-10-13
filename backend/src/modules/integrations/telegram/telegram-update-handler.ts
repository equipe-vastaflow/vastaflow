/**
 * Quem trata cada update que o polling le.
 *
 * Existe UM consumidor do bot (`TelegramPollingService`); o que varia e o destino de
 * cada mensagem, escolhido no boot por `TELEGRAM_DELIVERY_MODE`:
 *
 * - `direct`: `TelegramAdapter` (o backend avalia e responde);
 * - `n8n`: `TelegramRelayService` (assina um envelope e o entrega ao n8n).
 *
 * Um token em vez de dois consumidores: trocar de modo nunca cria um segundo
 * `getUpdates`, que o Telegram recusaria.
 */
export interface TelegramUpdateHandler {
  handleUpdate(raw: unknown): Promise<unknown>;
}

export const TELEGRAM_UPDATE_HANDLER = Symbol('TELEGRAM_UPDATE_HANDLER');

/**
 * Escolhe o tratador pelo modo. So `n8n` (exato) liga o relay; qualquer outro valor
 * - inclusive ausente - fica no modo direto, o padrao.
 */
export function selectUpdateHandler<T extends TelegramUpdateHandler>(
  mode: unknown,
  direct: T,
  relay: T,
): T {
  return mode === 'n8n' ? relay : direct;
}
