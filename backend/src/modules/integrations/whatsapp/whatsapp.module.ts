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
import { WhatsappInboundEvent } from './whatsapp-inbound-event.entity';
import { WhatsappInboundEventsRepository } from './whatsapp-inbound-events.repository';
import { WhatsappMessageProcessor } from './whatsapp-message.processor';
import { WHATSAPP_PROCESSOR, WhatsappController } from './whatsapp.controller';

/**
 * Canal WhatsApp (Cloud API OFICIAL da Meta). DESLIGADO por padrao (`WHATSAPP_ENABLED=false`: as
 * rotas respondem 404 e nada e enviado).
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
  controllers: [WhatsappController],
  providers: [
    WhatsappApiClient,
    WhatsappInboundEventsRepository,
    {
      provide: WHATSAPP_PROCESSOR,
      inject: [
        ConfigService,
        WhatsappInboundEventsRepository,
        CHANNEL_IDENTITY_RESOLVER,
        CHANNEL_LINK_CONFIRMER,
        CommandRouter,
        AuditService,
        WhatsappApiClient,
      ],
      useFactory: (
        config: ConfigService,
        events: WhatsappInboundEventsRepository,
        identities: ChannelIdentityResolver,
        linking: ChannelLinkConfirmer,
        router: CommandRouter,
        audit: AuditService,
        sender: WhatsappApiClient,
      ): WhatsappMessageProcessor =>
        new WhatsappMessageProcessor(
          () => config.get<string>('WHATSAPP_PHONE_NUMBER_ID') ?? '',
          events,
          identities,
          linking,
          router,
          audit,
          sender,
          () => Date.now(),
          () => config.get<boolean>('WHATSAPP_REPLY_TO_UNLINKED') === true,
        ),
    },
  ],
})
export class WhatsappModule {}
