/** Politica dos eventos do Telegram: constantes puras, sem dependencia. */

/** Um evento `PROCESSANDO` mais velho que isto esta preso (prazos do fluxo somam < 1 min). */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

/**
 * Menor retencao aceita. A idempotencia so protege enquanto o registro existe; apagar
 * cedo demais deixaria um update reentregue ser tratado como novo. O Telegram reentrega
 * por ate 24 h e o fluxo ja descarta mensagens com mais de `MESSAGE_MAX_AGE_MS`
 * (10 min, no polling E no ingest), entao 7 dias e uma folga larga - nao e o limite
 * teorico, e o piso conservador.
 */
export const EVENT_RETENTION_MIN_DAYS = 7;

/** Retencao automatica: primeira passada 10 min depois do boot (o boot nao compete com ela), depois 1 vez por dia. */
export const RETENTION_INITIAL_DELAY_MS = 10 * 60 * 1000;
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Retencao padrao dos eventos terminais quando a rotina automatica esta ligada. */
export const EVENT_RETENTION_DEFAULT_DAYS = 30;
