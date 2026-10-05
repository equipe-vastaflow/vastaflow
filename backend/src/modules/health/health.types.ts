/**
 * Estado agregado ou individual de um componente do sistema.
 *
 * - `ok`       componente respondendo normalmente
 * - `degraded` componente respondendo, porem fora do esperado
 * - `down`     componente indisponivel
 */
export type HealthStatus = 'ok' | 'degraded' | 'down';

/**
 * Resultado da verificacao de um unico componente.
 */
export interface HealthIndicatorResult {
  readonly status: HealthStatus;
  /** Mensagem curta e SEM dados sensiveis (nunca host, usuario ou senha). */
  readonly detail?: string;
}

/**
 * Contrato que um componente verificavel deve implementar.
 *
 * Ponto de extensao previsto no briefing: banco de dados (Etapa 2) e
 * integracoes externas (Etapa 5+) entram aqui, sem alterar o controller
 * nem o service - basta registrar o indicador no `HealthModule`.
 */
export interface HealthIndicator {
  /** Chave do componente na resposta. Ex.: 'database', 'plantae'. */
  readonly name: string;
  check(): Promise<HealthIndicatorResult>;
}

/**
 * Token de injecao dos indicadores de LIVENESS (`GET /health`).
 *
 * Fica vazio de proposito: liveness responde "o processo esta vivo" e nao deve
 * depender de banco nem de integracao - senao uma queda de dependencia faria o
 * processo ser reiniciado sem motivo.
 */
export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');

/**
 * Token de injecao dos indicadores de READINESS (`GET /health/readiness`).
 *
 * Aqui entram as dependencias sem as quais a aplicacao nao consegue atender -
 * hoje so o banco. Integracao externa NAO entra: ver `ReadinessService`.
 */
export const READINESS_INDICATORS = Symbol('READINESS_INDICATORS');
