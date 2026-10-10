import type { HealthIndicatorResult } from '../../health/health.types';
import { IntegrationCategory, IntegrationStatus } from '../integration.enums';
import type { ConfigReader } from '../integration-config';
import type { IntegrationMetadata, IntegrationProvider } from '../integration.types';
import { PlantaeApiError } from './plantae-errors';
import type { PlantaeHttpClient } from './plantae-http.client';
import { resolvePlantaeSettings } from './plantae-settings';
import { HEALTH_CACHE_MS, PLANTAE_PROVIDER_ID } from './plantae.constants';
import type { PlantaeService } from './plantae.service';

/**
 * O Plantae visto pela foundation de integracoes (`IntegrationRegistry`).
 *
 * - `metadata`: so identidade publica. Nenhum dado da organizacao, nenhum token;
 * - `getStatus`: LOCAL, sem rede - `DISABLED` se desligado, `NOT_CONFIGURED` se
 *   faltar URL ou token, `READY` caso contrario;
 * - `healthCheck`: `GET /me`, com o timeout do cliente, e so quando alguem pede
 *   (o registro nunca o chama sozinho e o boot nao depende dele). O resultado e
 *   reaproveitado por `HEALTH_CACHE_MS`: a cota do Plantae e de 60 req/min por
 *   chave, e consultar o estado nao pode consumi-la.
 *
 * A mensagem publica do health e decidida pelo registro, que descarta o `detail`
 * do provider - por isso nao ha `detail` aqui.
 */
export class PlantaeProvider implements IntegrationProvider {
  readonly metadata: IntegrationMetadata = {
    id: PLANTAE_PROVIDER_ID,
    name: 'Plantae',
    category: IntegrationCategory.Other,
  };

  private cached: { readonly until: number; readonly result: HealthIndicatorResult } | null = null;
  private inFlight: Promise<HealthIndicatorResult> | null = null;

  constructor(
    private readonly client: PlantaeHttpClient,
    private readonly service: PlantaeService,
    private readonly config: ConfigReader,
    private readonly now: () => number = (): number => Date.now(),
  ) {}

  getStatus(): Promise<IntegrationStatus> {
    if (!resolvePlantaeSettings(this.config).enabled) {
      return Promise.resolve(IntegrationStatus.Disabled);
    }
    return Promise.resolve(
      this.client.isConfigured() ? IntegrationStatus.Ready : IntegrationStatus.NotConfigured,
    );
  }

  healthCheck(): Promise<HealthIndicatorResult> {
    if (this.cached !== null && this.cached.until > this.now()) {
      return Promise.resolve(this.cached.result);
    }
    // Chamadas simultaneas dividem UMA consulta ao Plantae.
    this.inFlight ??= this.probe().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async probe(): Promise<HealthIndicatorResult> {
    let result: HealthIndicatorResult;
    try {
      await this.service.getMe();
      result = { status: 'ok' };
    } catch (error) {
      if (!(error instanceof PlantaeApiError)) {
        throw error;
      }
      // A categoria ja foi registrada pelo servico (sem token e sem corpo).
      result = { status: 'down' };
    }
    this.cached = { until: this.now() + HEALTH_CACHE_MS, result };
    return result;
  }
}
