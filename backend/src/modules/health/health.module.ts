import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HEALTH_INDICATORS, type HealthIndicator } from './health.types';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      // Lista de componentes verificados pelo /health.
      //
      // Hoje vazia, de proposito: o briefing pede que a aplicacao responda
      // `{ status: 'ok', service: 'vasta-flow' }` sem depender de banco nem de
      // integracao. Para incluir um componente, implemente `HealthIndicator`
      // e adicione-o abaixo - nada mais precisa mudar.
      provide: HEALTH_INDICATORS,
      useFactory: (): HealthIndicator[] => [],
    },
  ],
})
export class HealthModule {}
