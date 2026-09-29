import { Module, type OnModuleInit } from '@nestjs/common';
import { CommandsModule } from '../../commands/commands.module';
import { CHANNEL_IDENTITY_RESOLVER, UnlinkedIdentityResolver } from '../channels/channel-identity';
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
 * (`TELEGRAM_POLLING_ENABLED`). Sem entity, tabela ou migration.
 *
 * O resolvedor de identidade desta etapa e o `UnlinkedIdentityResolver`: ainda
 * nao existe vinculo entre conta do Telegram e usuario interno, entao nenhum
 * comando e executado por este canal. Trocar o resolvedor (quando a vinculacao
 * existir) nao muda adapter, polling nem Command Engine.
 */
@Module({
  imports: [IntegrationsModule, CommandsModule],
  providers: [
    TelegramApiClient,
    TelegramProvider,
    TelegramAdapter,
    TelegramPollingService,
    { provide: CHANNEL_IDENTITY_RESOLVER, useClass: UnlinkedIdentityResolver },
  ],
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
