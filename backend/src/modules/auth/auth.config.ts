const UNIT_IN_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/**
 * Converte `15m`, `1h`, `7d` em segundos. O formato ja foi validado no boot
 * (`JWT_EXPIRES_IN`); a excecao aqui apenas protege contra uso indevido.
 */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Duracao invalida: '${value}'. Use o formato 15m, 1h, 7d.`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_IN_SECONDS[unit as keyof typeof UNIT_IN_SECONDS];
}
