import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SlidingWindowLimiter } from '../../../common/rate-limit/sliding-window-limiter';
import { AuditModule } from '../../audit/audit.module';
import { CommandCatalog } from '../../commands/command-catalog';
import { CommandsModule } from '../../commands/commands.module';
import { IntegrationRegistry } from '../integration-registry';
import { IntegrationsModule } from '../integrations.module';
import {
  AccountsPayableCommandHandler,
  AccountsReceivableCommandHandler,
  createPlantaeChatLimiter,
  PLANTAE_CHAT_LIMITER,
} from './plantae-accounts-payable.command';
import { PlantaeHttpClient } from './plantae-http.client';
import { PlantaeController } from './plantae.controller';
import { PlantaeProvider } from './plantae.provider';
import { PlantaeService } from './plantae.service';

/**
 * Integracao com a API externa do Plantae: SOMENTE leitura, hosts fixos (homologacao e producao).
 *
 * Camadas, de baixo para cima, sem ciclo:
 *
 *   PlantaeHttpClient  - unico lugar com `fetch`, token e limitador de taxa
 *   PlantaeService     - filtros validados, paginacao por cursor, resposta validada
 *   PlantaeProvider    - o Plantae visto pelo `IntegrationRegistry`
 *   PlantaeController  - consultas GET para ADMIN humano, auditadas
 *
 * Depende so da foundation (`IntegrationsModule`) e da auditoria. NAO depende de
 * modulo de negocio (Finance, Documents...): dado do Plantae nao se mistura com
 * lancamento local e nao e gravado. Sem entity, tabela ou migration.
 *
 * Alem das rotas HTTP, registra os comandos de chat `/contas_pagar` e `/contas_receber`
 * no Command Engine (desligados por padrao: `PLANTAE_CHAT_COMMANDS_ENABLED`). Os dois
 * dividem UM limitador por pessoa (`PLANTAE_CHAT_LIMITER`).
 *
 * Desligada por padrao (`PLANTAE_ENABLED=false`). Registrar o provider nao chama
 * o Plantae, e o Plantae fora do ar nao impede a aplicacao de subir.
 *
 * As classes sao montadas por factory porque dependem de abstracoes (leitor de
 * configuracao), e os testes montam as mesmas classes com dependencias falsas.
 */
@Module({
  imports: [IntegrationsModule, AuditModule, CommandsModule],
  controllers: [PlantaeController],
  providers: [
    {
      provide: PlantaeHttpClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PlantaeHttpClient => new PlantaeHttpClient(config),
    },
    {
      provide: PlantaeService,
      inject: [PlantaeHttpClient, ConfigService],
      useFactory: (client: PlantaeHttpClient, config: ConfigService): PlantaeService =>
        new PlantaeService(client, config),
    },
    {
      provide: PlantaeProvider,
      inject: [PlantaeHttpClient, PlantaeService, ConfigService],
      useFactory: (
        client: PlantaeHttpClient,
        service: PlantaeService,
        config: ConfigService,
      ): PlantaeProvider => new PlantaeProvider(client, service, config),
    },
    // Cota de consultas por pessoa DIVIDIDA entre pagar e receber (3/min no total).
    { provide: PLANTAE_CHAT_LIMITER, useFactory: createPlantaeChatLimiter },
    {
      provide: AccountsPayableCommandHandler,
      inject: [PlantaeService, ConfigService, PLANTAE_CHAT_LIMITER],
      useFactory: (
        service: PlantaeService,
        config: ConfigService,
        limiter: SlidingWindowLimiter,
      ): AccountsPayableCommandHandler =>
        new AccountsPayableCommandHandler(service, config, undefined, limiter),
    },
    {
      provide: AccountsReceivableCommandHandler,
      inject: [PlantaeService, ConfigService, PLANTAE_CHAT_LIMITER],
      useFactory: (
        service: PlantaeService,
        config: ConfigService,
        limiter: SlidingWindowLimiter,
      ): AccountsReceivableCommandHandler =>
        new AccountsReceivableCommandHandler(service, config, undefined, limiter),
    },
  ],
})
export class PlantaeModule implements OnModuleInit {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly provider: PlantaeProvider,
    private readonly catalog: CommandCatalog,
    private readonly accountsPayable: AccountsPayableCommandHandler,
    private readonly accountsReceivable: AccountsReceivableCommandHandler,
  ) {}

  /**
   * Registrar nao chama o Plantae: o registro e o catalogo so guardam a
   * referencia. Os comandos `/contas_pagar` e `/contas_receber` entram no Command
   * Engine EXISTENTE (nao ha um segundo motor) e ficam atras da permissao
   * `plantae:read` e do opt-in `PLANTAE_CHAT_COMMANDS_ENABLED`.
   */
  onModuleInit(): void {
    this.registry.register(this.provider);
    this.catalog.register([this.accountsPayable, this.accountsReceivable]);
  }
}
