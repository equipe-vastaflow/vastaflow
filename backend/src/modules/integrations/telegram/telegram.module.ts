import { Module, type OnModuleInit } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module';
import { ExternalIdentitiesModule } from '../../external-identities/external-identities.module';
import { IntegrationRegistry } from '../integration-registry';
import { IntegrationsModule } from '../integrations.module';
import { TelegramAdapter } from './telegram.adapter';
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
 * A identidade vem do `CHANNEL_IDENTITY_RESOLVER` exportado pelo
 * `ExternalIdentitiesModule` (vinculos administrativos no banco). O adapter so
 * conhece o contrato `ChannelIdentityResolver`: nenhuma consulta ao banco mora
 * neste modulo. Sem vinculo, ou com o usuario inativo, nenhum comando e
 * executado.
 */
@Module({
  imports: [IntegrationsModule, CommandsModule, ExternalIdentitiesModule],
  providers: [TelegramApiClient, TelegramProvider, TelegramAdapter, TelegramPollingService],
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
