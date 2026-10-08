import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { ServiceCredentialsStore } from './service-credentials.store';
import { ServiceController } from './service.controller';

/**
 * Autenticacao servico-a-servico (n8n -> NestJS).
 *
 * Este modulo fornece a fonte das credenciais e as rotas de servico. O GUARD
 * (`ServiceAuthGuard`) NAO e registrado aqui, e sim no `AuthModule`, na mesma
 * lista dos demais guards globais: a ordem de execucao dos `APP_GUARD` e a
 * ordem em que aparecem naquela lista, e ter os quatro lado a lado e o que
 * mantem essa ordem visivel e revisavel.
 *
 * Sem `SERVICE_CREDENTIALS_FILE` o recurso fica DESLIGADO: toda rota de servico
 * responde 401. A aplicacao sobe normalmente sem ele.
 */
@Module({
  controllers: [ServiceController],
  providers: [
    {
      provide: ServiceCredentialsStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): ServiceCredentialsStore =>
        new ServiceCredentialsStore({
          path: config.get('SERVICE_CREDENTIALS_FILE', { infer: true }),
        }),
    },
  ],
  exports: [ServiceCredentialsStore],
})
export class ServiceAuthModule {}
