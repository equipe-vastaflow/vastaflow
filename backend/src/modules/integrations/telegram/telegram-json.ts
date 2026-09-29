/** Objeto JSON (nao nulo, nao array). O payload do Telegram e validado a partir disto. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
