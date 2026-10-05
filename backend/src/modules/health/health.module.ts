import { Module } from '@nestjs/common';
import { DatabaseReadinessIndicator } from './database-readiness.indicator';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HEALTH_INDICATORS, READINESS_INDICATORS, type HealthIndicator } from './health.types';
import { ReadinessService } from './readiness.service';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    ReadinessService,
    DatabaseReadinessIndicator,
    {
      // Componentes verificados pelo LIVENESS (`GET /health`).
      //
      // Vazia de proposito: o briefing pede que a aplicacao responda
      // `{ status: 'ok', service: 'vasta-flow' }` sem depender de banco nem de
      // integracao. Dependencia verificavel entra no readiness, abaixo.
      provide: HEALTH_INDICATORS,
      useFactory: (): HealthIndicator[] => [],
    },
    {
      // Componentes verificados pelo READINESS (`GET /health/readiness`).
      //
      // Somente o que impede a aplicacao de trabalhar. Para incluir outro,
      // implemente `HealthIndicator` e adicione-o aqui - nada mais muda.
      provide: READINESS_INDICATORS,
      useFactory: (database: DatabaseReadinessIndicator): HealthIndicator[] => [database],
      inject: [DatabaseReadinessIndicator],
    },
  ],
})
export class HealthModule {}
