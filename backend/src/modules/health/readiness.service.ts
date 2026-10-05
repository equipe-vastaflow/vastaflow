import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { HealthCheckDetailDto, HealthResponseDto } from './dto/health-response.dto';
import { READINESS_INDICATORS, type HealthIndicator, type HealthStatus } from './health.types';

/** Readiness resolvido: a resposta e o status HTTP que deve acompanha-la. */
export interface ReadinessOutcome {
  readonly body: HealthResponseDto;
  /** `true` quando algum componente esta `down` - a resposta deve ser 503. */
  readonly unavailable: boolean;
}

/**
 * Readiness: a aplicacao consegue atender requisicoes agora?
 *
 * Separado do `HealthService` (liveness) de proposito. Sao perguntas
 * diferentes - "o processo esta vivo" e "o processo consegue trabalhar" - e com
 * consumidores diferentes: liveness decide reiniciar, readiness decide mandar
 * trafego. Juntar as duas num endpoint faria uma queda do banco derrubar
 * tambem a resposta de liveness, e o processo seria reiniciado sem motivo.
 *
 * Verifica SOMENTE dependencias sem as quais a aplicacao nao funciona - hoje,
 * apenas o banco. Integracao externa (Telegram e as futuras) NAO entra: elas
 * sao opcionais, e uma indisponibilidade do fornecedor tiraria o VastaFlow do
 * ar sem necessidade.
 */
@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    @Inject(READINESS_INDICATORS) private readonly indicators: readonly HealthIndicator[],
  ) {}

  async check(): Promise<ReadinessOutcome> {
    const service = this.configService.get('APP_NAME', { infer: true });

    const entries = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, HealthCheckDetailDto]> => {
        try {
          const result = await indicator.check();
          return [indicator.name, { status: result.status, detail: result.detail }];
        } catch (error) {
          // Um indicador que lanca e reportado como `down`, e os demais seguem
          // sendo avaliados - mesmo critério do HealthService.
          this.logger.error(
            `Falha ao verificar a prontidao de '${indicator.name}'`,
            error instanceof Error ? error.stack : String(error),
          );
          return [indicator.name, { status: 'down', detail: 'verificacao falhou' }];
        }
      }),
    );

    const status = aggregateStatus(entries.map(([, detail]) => detail.status));

    return {
      body: { status, service, checks: Object.fromEntries(entries) },
      unavailable: status === 'down',
    };
  }
}

/** O estado agregado assume o pior estado encontrado entre os componentes. */
function aggregateStatus(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.includes('down')) {
    return 'down';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'ok';
}
