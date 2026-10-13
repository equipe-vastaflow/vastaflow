import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { AuditService } from '../../audit/audit.service';
import { TelegramAdapter } from '../telegram/telegram.adapter';
import { TelegramModule } from '../telegram/telegram.module';
import { TelegramInboundEvent } from './telegram-inbound-event.entity';
import { TelegramInboundEventsRepository } from './telegram-inbound-events.repository';
import { STUCK_AFTER_MS } from './telegram-events.policy';
import { TelegramIngestController } from './telegram-ingest.controller';
import { TelegramIngestService } from './telegram-ingest.service';

/**
 * Lado AUTORIDADE do fluxo Telegram -> n8n -> backend.
 *
 * Recebe, por uma rota exclusiva de servico, os envelopes assinados que o n8n
 * repassa; verifica, reserva no banco (idempotencia), identifica a pessoa
 * vinculada, aplica o RBAC dela e executa pelo Command Engine existente - via o
 * `TelegramAdapter.processMessage`, o mesmo caminho do modo direto.
 *
 * NAO inicia consumidor nenhum: quem le o Telegram continua sendo o
 * `TelegramPollingService` (um por processo). Este modulo so responde a HTTP.
 *
 * Tem uma entity e uma migration (`telegram_inbound_events`): a idempotencia
 * persistente nao pode morar em memoria. A classe do servico e montada por factory
 * porque depende de abstracoes (leitor de configuracao) e de um relogio injetavel.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TelegramInboundEvent]), TelegramModule, AuditModule],
  controllers: [TelegramIngestController],
  providers: [
    TelegramInboundEventsRepository,
    {
      provide: TelegramIngestService,
      inject: [ConfigService, TelegramInboundEventsRepository, TelegramAdapter, AuditService],
      useFactory: (
        config: ConfigService,
        events: TelegramInboundEventsRepository,
        adapter: TelegramAdapter,
        audit: AuditService,
      ): TelegramIngestService => new TelegramIngestService(config, events, adapter, audit),
    },
  ],
})
export class TelegramIngestModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramIngestModule.name);

  constructor(private readonly events: TelegramInboundEventsRepository) {}

  /**
   * Observabilidade: avisa no log se ha eventos presos em `PROCESSANDO` (queda no meio
   * de uma mensagem). So o numero - nenhum conteudo. Nunca impede o boot. O que fazer:
   * `docs/telegram-n8n.md` (eventos presos) e o CLI `telegram-events`.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const stuck = await this.events.findStuck(new Date(Date.now() - STUCK_AFTER_MS), 100);
      if (stuck.length > 0) {
        this.logger.warn(
          `Telegram: ${String(stuck.length)} evento(s) preso(s) em PROCESSANDO; ` +
            'rode o CLI telegram-events report',
        );
      }
    } catch {
      // Diagnostico opcional: a tabela pode nao existir em um ambiente sem migrations.
    }
  }
}
