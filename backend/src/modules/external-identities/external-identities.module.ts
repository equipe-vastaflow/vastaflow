import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CHANNEL_IDENTITY_RESOLVER } from '../integrations/channels/channel-identity';
import { CHANNEL_LINK_CONFIRMER } from '../integrations/channels/channel-link';
import { UsersModule } from '../users/users.module';
import { DatabaseIdentityResolver } from './database-identity.resolver';
import { ExternalIdentityLink } from './entities/external-identity-link.entity';
import { IdentityLinkRequest } from './entities/identity-link-request.entity';
import { ExternalIdentitiesController } from './external-identities.controller';
import { ExternalIdentitiesRepository } from './external-identities.repository';
import { ExternalIdentitiesService } from './external-identities.service';
import { IdentityLinkRequestsRepository } from './identity-link-requests.repository';
import { LinkConfirmationService } from './link-confirmation.service';

/**
 * Vinculos entre identidades externas (conta do Telegram) e usuarios internos.
 *
 * - administracao: `/users/:id/external-identities` - inicia/cancela
 *   solicitacoes e remove vinculos (auditado). Nunca cria vinculo direto;
 * - confirmacao de posse: exporta o `CHANNEL_LINK_CONFIRMER`, pelo qual a propria
 *   conta externa confirma a solicitacao enviando o codigo;
 * - resolucao: exporta o `CHANNEL_IDENTITY_RESOLVER` que os adaptadores consomem.
 *
 * Os adaptadores de canal so conhecem esses dois contratos - o banco fica aqui.
 * Depende de `UsersModule` e `AuditModule`; nao depende de canal nenhum.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ExternalIdentityLink, IdentityLinkRequest]),
    UsersModule,
    AuditModule,
  ],
  controllers: [ExternalIdentitiesController],
  providers: [
    ExternalIdentitiesRepository,
    IdentityLinkRequestsRepository,
    ExternalIdentitiesService,
    { provide: CHANNEL_IDENTITY_RESOLVER, useClass: DatabaseIdentityResolver },
    { provide: CHANNEL_LINK_CONFIRMER, useClass: LinkConfirmationService },
  ],
  exports: [CHANNEL_IDENTITY_RESOLVER, CHANNEL_LINK_CONFIRMER],
})
export class ExternalIdentitiesModule {}
