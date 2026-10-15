import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { Document } from '../modules/documents/entities/document.entity';
import { ExternalIdentityLink } from '../modules/external-identities/entities/external-identity-link.entity';
import { IdentityLinkRequest } from '../modules/external-identities/entities/identity-link-request.entity';
import { FinancialEntry } from '../modules/finance/entities/financial-entry.entity';
import { NfseEmission } from '../modules/integrations/nfse/nfse-emission.entity';
import { TelegramInboundEvent } from '../modules/integrations/telegram-ingest/telegram-inbound-event.entity';
import { WhatsappInboundEvent } from '../modules/integrations/whatsapp/whatsapp-inbound-event.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Role } from '../modules/roles/entities/role.entity';
import { SystemSetting } from '../modules/settings/entities/system-setting.entity';
import { User } from '../modules/users/entities/user.entity';

/**
 * Todas as entities persistidas.
 *
 * Fonte unica usada pela aplicacao, pelo CLI de migrations e pelos testes de
 * compatibilidade MySQL/Oracle. Entity nova precisa entrar aqui (alem do
 * `TypeOrmModule.forFeature` do seu modulo) - do contrario o CLI nao a enxerga
 * e nenhuma migration e gerada para ela.
 */
export const ENTITIES = [
  Permission,
  Role,
  User,
  AuditLog,
  FinancialEntry,
  SystemSetting,
  Notification,
  ExternalIdentityLink,
  IdentityLinkRequest,
  Document,
  TelegramInboundEvent,
  WhatsappInboundEvent,
  NfseEmission,
];
