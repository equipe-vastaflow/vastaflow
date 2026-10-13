import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandsModule } from '../../commands/commands.module';
import { ExternalIdentitiesModule } from '../../external-identities/external-identities.module';
import { IntegrationRegistry } from '../integration-registry';
import { IntegrationsModule } from '../integrations.module';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramN8nClient } from './telegram-n8n.client';
import { TelegramRelayService } from './telegram-relay.service';
import { selectUpdateHandler, TELEGRAM_UPDATE_HANDLER } from './telegram-update-handler';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramPollingService } from './telegram-polling.service';
import { TelegramProvider } from './telegram.provider';

/**
 * Canal Telegram: primeira integracao externa real.
 *
 * Depende de cima para baixo, sem ciclo:
 * - `IntegrationsModule` (foundation) - registra o `TelegramProvider`;
 * - `CommandsModule` - usa o `CommandRouter` publico. O motor nao importa este
 *   modulo e nao conhece o Telegram.
 *
 * Nao depende de nenhum modulo de negocio (Finance, Notifications, Users). Nao
 * abre rota HTTP: o recebimento e por long polling, opt-in
 * (`TELEGRAM_POLLING_ENABLED`). Sem entity, tabela ou migration proprias.
 *
 * Dois modos de entrega (`TELEGRAM_DELIVERY_MODE`), com UM so consumidor:
 * `direct` (padrao) avalia no proprio backend; `n8n` assina e entrega ao n8n (o
 * lado que recebe esse envelope e o modulo `telegram-ingest`).
 *
 * A identidade vem do `CHANNEL_IDENTITY_RESOLVER` exportado pelo
 * `ExternalIdentitiesModule` (vinculos administrativos no banco). O adapter so
 * conhece o contrato `ChannelIdentityResolver`: nenhuma consulta ao banco mora
 * neste modulo. Sem vinculo, ou com o usuario inativo, nenhum comando e
 * executado.
 */
@Module({
  imports: [IntegrationsModule, CommandsModule, ExternalIdentitiesModule],
  providers: [
    TelegramApiClient,
    TelegramProvider,
    TelegramAdapter,
    TelegramN8nClient,
    TelegramRelayService,
    {
      // UM consumidor (o polling); o modo escolhe so quem trata cada mensagem.
      provide: TELEGRAM_UPDATE_HANDLER,
      inject: [ConfigService, TelegramAdapter, TelegramRelayService],
      useFactory: (
        config: ConfigService,
        adapter: TelegramAdapter,
        relay: TelegramRelayService,
      ): TelegramAdapter | TelegramRelayService =>
        selectUpdateHandler<TelegramAdapter | TelegramRelayService>(
          config.get<string>('TELEGRAM_DELIVERY_MODE'),
          adapter,
          relay,
        ),
    },
    TelegramPollingService,
  ],
  // O adaptador e reutilizado pela entrada de servico (`telegram-ingest`) para
  // avaliar a mensagem pelo MESMO caminho do modo direto.
  exports: [TelegramAdapter],
})
export class TelegramModule implements OnModuleInit {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly provider: TelegramProvider,
  ) {}

  /** Registrar nao chama o Telegram: o registro so guarda a referencia. */
  onModuleInit(): void {
    this.registry.register(this.provider);
  }
}
