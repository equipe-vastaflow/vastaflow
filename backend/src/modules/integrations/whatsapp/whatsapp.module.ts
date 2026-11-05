import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../../audit/audit.module';
import { AuditService } from '../../audit/audit.service';
import { CommandRouter } from '../../commands/command-router.service';
import { CommandsModule } from '../../commands/commands.module';
import { ExternalIdentitiesModule } from '../../external-identities/external-identities.module';
import {
  CHANNEL_IDENTITY_RESOLVER,
  type ChannelIdentityResolver,
} from '../channels/channel-identity';
import { CHANNEL_LINK_CONFIRMER, type ChannelLinkConfirmer } from '../channels/channel-link';
import { WhatsappApiClient } from './whatsapp-api.client';
import { WhatsappIngestController } from './whatsapp-ingest.controller';
import { WhatsappInboundEvent } from './whatsapp-inbound-event.entity';
import { WhatsappInboundEventsRepository } from './whatsapp-inbound-events.repository';
import { WhatsappMessageProcessor } from './whatsapp-message.processor';
import { WHATSAPP_PROCESSOR } from './whatsapp-processor.token';
import { resolveWhatsappTransport } from './whatsapp-settings';
import { WHATSAPP_SENDER, WhatsappController } from './whatsapp.controller';

/**
 * Canal WhatsApp. DESLIGADO por padrao (`WHATSAPP_ENABLED=false`: as rotas respondem 404 e nada e enviado).
 *
 * Dois TRANSPORTES, um ativo por vez (`WHATSAPP_TRANSPORT`):
 * - `meta` (padrao): Cloud API oficial, webhook em `/webhooks/whatsapp`;
 * - `gateway`: conteiner whatsapp-gateway (Baileys), que chama `POST /service/whatsapp/ingest` com credencial de
 *   servico. Migracao gradual e reversivel: o codigo da Meta segue aqui ate a nova integracao ser validada.
 *
 * O PROCESSADOR e unico e nao conhece transporte: devolve o texto da resposta e cada transporte a entrega ao
 * remetente da mesma mensagem.
 *
 * O webhook da Meta chega DIRETO ao backend - sem n8n no caminho: a assinatura
 * (`X-Hub-Signature-256`) exige o corpo bruto e o App Secret, e o segredo nao deve sair do
 * backend. Mesma cadeia dos outros canais: identidade (`external_identity_links`, canal
 * `whatsapp`) -> RBAC -> Command Engine -> auditoria -> resposta. Ver `docs/whatsapp.md`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WhatsappInboundEvent]),
    CommandsModule,
    ExternalIdentitiesModule,
    AuditModule,
  ],
  controllers: [WhatsappController, WhatsappIngestController],
  providers: [
    WhatsappApiClient,
    WhatsappInboundEventsRepository,
    { provide: WHATSAPP_SENDER, useExisting: WhatsappApiClient },
    {
      provide: WHATSAPP_PROCESSOR,
      inject: [
        ConfigService,
        WhatsappInboundEventsRepository,
        CHANNEL_IDENTITY_RESOLVER,
        CHANNEL_LINK_CONFIRMER,
        CommandRouter,
        AuditService,
      ],
      useFactory: (
        config: ConfigService,
        events: WhatsappInboundEventsRepository,
        identities: ChannelIdentityResolver,
        linking: ChannelLinkConfirmer,
        router: CommandRouter,
        audit: AuditService,
      ): WhatsappMessageProcessor =>
        new WhatsappMessageProcessor(
          // Cada transporte so aceita mensagens destinadas ao SEU numero; so um esta ativo por vez.
          () =>
            (resolveWhatsappTransport(config.get<string>('WHATSAPP_TRANSPORT')) === 'gateway'
              ? config.get<string>('WHATSAPP_GATEWAY_ACCOUNT')
              : config.get<string>('WHATSAPP_PHONE_NUMBER_ID')) ?? '',
          events,
          identities,
          linking,
          router,
          audit,
          () => Date.now(),
          () => config.get<boolean>('WHATSAPP_REPLY_TO_UNLINKED') === true,
        ),
    },
  ],
})
export class WhatsappModule {}
