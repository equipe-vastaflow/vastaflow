import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { HealthResponseDto, HealthCheckDetailDto } from './dto/health-response.dto';
import { HEALTH_INDICATORS, type HealthIndicator, type HealthStatus } from './health.types';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    @Inject(HEALTH_INDICATORS) private readonly indicators: readonly HealthIndicator[],
  ) {}

  /**
   * Verifica a aplicacao e todos os indicadores registrados.
   *
   * Sem indicadores registrados a resposta e apenas `{ status, service }`.
   * O campo `checks` so aparece quando ha componentes a reportar.
   */
  async check(): Promise<HealthResponseDto> {
    const service = this.configService.get('APP_NAME', { infer: true });

    if (this.indicators.length === 0) {
      return { status: 'ok', service };
    }

    const entries = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, HealthCheckDetailDto]> => {
        try {
          const result = await indicator.check();
          return [indicator.name, { status: result.status, detail: result.detail }];
        } catch (error) {
          // Um indicador que lanca excecao nao pode derrubar o endpoint inteiro:
          // ele e reportado como `down` e os demais continuam sendo avaliados.
          this.logger.error(
            `Falha ao verificar o componente '${indicator.name}'`,
            error instanceof Error ? error.stack : String(error),
          );
          return [indicator.name, { status: 'down', detail: 'verificacao falhou' }];
        }
      }),
    );

    const checks = Object.fromEntries(entries);

    return {
      status: aggregateStatus(entries.map(([, detail]) => detail.status)),
      service,
      checks,
    };
  }
}

/**
 * O estado agregado assume o pior estado encontrado entre os componentes.
 */
function aggregateStatus(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.includes('down')) {
    return 'down';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'ok';
}
