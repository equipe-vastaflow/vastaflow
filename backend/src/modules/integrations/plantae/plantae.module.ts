import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../../audit/audit.module';
import { CommandCatalog } from '../../commands/command-catalog';
import { CommandsModule } from '../../commands/commands.module';
import { IntegrationRegistry } from '../integration-registry';
import { IntegrationsModule } from '../integrations.module';
import { AccountsPayableCommandHandler } from './plantae-accounts-payable.command';
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
 * Alem das rotas de ADMIN, registra o comando de chat `/contas_pagar` no Command
 * Engine (desligado por padrao: `PLANTAE_CHAT_COMMANDS_ENABLED`).
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
    {
      provide: AccountsPayableCommandHandler,
      inject: [PlantaeService, ConfigService],
      useFactory: (service: PlantaeService, config: ConfigService): AccountsPayableCommandHandler =>
        new AccountsPayableCommandHandler(service, config),
    },
  ],
})
export class PlantaeModule implements OnModuleInit {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly provider: PlantaeProvider,
    private readonly catalog: CommandCatalog,
    private readonly accountsPayable: AccountsPayableCommandHandler,
  ) {}

  /**
   * Registrar nao chama o Plantae: o registro e o catalogo so guardam a
   * referencia. O comando `/contas_pagar` entra no Command Engine EXISTENTE (nao ha
   * um segundo motor) e fica atras da permissao `plantae:read` e do opt-in
   * `PLANTAE_CHAT_COMMANDS_ENABLED`.
   */
  onModuleInit(): void {
    this.registry.register(this.provider);
    this.catalog.register([this.accountsPayable]);
  }
}
