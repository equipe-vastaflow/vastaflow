import type { MigrationInterface } from 'typeorm';
import type { DatabaseType } from '../../config/env.validation';
import { ExternalIdentityLinks1790798470956 as MysqlExternalIdentityLinks } from './mysql/1790798470956-ExternalIdentityLinks';
import { FinancialEntries1790136699120 as MysqlFinancialEntries } from './mysql/1790136699120-FinancialEntries';
import { Documents1791257785308 as MysqlDocuments } from './mysql/1791257785308-Documents';
import { IdentityLinkRequests1790799667076 as MysqlIdentityLinkRequests } from './mysql/1790799667076-IdentityLinkRequests';
import { InitialSchema1790020288252 as MysqlInitialSchema } from './mysql/1790020288252-InitialSchema';
import { Notifications1790305530902 as MysqlNotifications } from './mysql/1790305530902-Notifications';
import { NotificationsReadAt1790706805546 as MysqlNotificationsReadAt } from './mysql/1790706805546-NotificationsReadAt';
import { SystemSettings1790303010994 as MysqlSystemSettings } from './mysql/1790303010994-SystemSettings';
import { TelegramInboundEvents1791500000000 as MysqlTelegramInboundEvents } from './mysql/1791500000000-TelegramInboundEvents';
import { WhatsappInboundEvents1791600000000 as MysqlWhatsappInboundEvents } from './mysql/1791600000000-WhatsappInboundEvents';
import { NfseEmissions1791700000000 as MysqlNfseEmissions } from './mysql/1791700000000-NfseEmissions';
import { WhatsappAuthState1791800000000 as MysqlWhatsappAuthState } from './mysql/1791800000000-WhatsappAuthState';
import { ExternalIdentityLinks1790798470956 as OracleExternalIdentityLinks } from './oracle/1790798470956-ExternalIdentityLinks';
import { FinancialEntries1790136699120 as OracleFinancialEntries } from './oracle/1790136699120-FinancialEntries';
import { Documents1791257785308 as OracleDocuments } from './oracle/1791257785308-Documents';
import { IdentityLinkRequests1790799667076 as OracleIdentityLinkRequests } from './oracle/1790799667076-IdentityLinkRequests';
import { InitialSchema1790020288252 as OracleInitialSchema } from './oracle/1790020288252-InitialSchema';
import { Notifications1790305530902 as OracleNotifications } from './oracle/1790305530902-Notifications';
import { NotificationsReadAt1790706805546 as OracleNotificationsReadAt } from './oracle/1790706805546-NotificationsReadAt';
import { SystemSettings1790303010994 as OracleSystemSettings } from './oracle/1790303010994-SystemSettings';
import { TelegramInboundEvents1791500000000 as OracleTelegramInboundEvents } from './oracle/1791500000000-TelegramInboundEvents';
import { WhatsappInboundEvents1791600000000 as OracleWhatsappInboundEvents } from './oracle/1791600000000-WhatsappInboundEvents';
import { NfseEmissions1791700000000 as OracleNfseEmissions } from './oracle/1791700000000-NfseEmissions';
import { WhatsappAuthState1791800000000 as OracleWhatsappAuthState } from './oracle/1791800000000-WhatsappAuthState';

type MigrationClass = new () => MigrationInterface;

/**
 * Migrations registradas, por banco (ADR 0001: o DDL nao e portavel).
 *
 * Lista explicita em vez de glob: funciona igual no codigo compilado, no
 * ts-jest e no CLI. Toda migration nova precisa ser adicionada aqui, na ordem
 * de execucao - o teste `database-compatibility.spec.ts` falha se algum arquivo
 * das pastas `mysql/` ou `oracle/` ficar de fora.
 */
export const MIGRATIONS: Record<DatabaseType, MigrationClass[]> = {
  mysql: [
    MysqlInitialSchema,
    MysqlFinancialEntries,
    MysqlSystemSettings,
    MysqlNotifications,
    MysqlNotificationsReadAt,
    MysqlExternalIdentityLinks,
    MysqlIdentityLinkRequests,
    MysqlDocuments,
    MysqlTelegramInboundEvents,
    MysqlWhatsappInboundEvents,
    MysqlNfseEmissions,
    MysqlWhatsappAuthState,
  ],
  oracle: [
    OracleInitialSchema,
    OracleFinancialEntries,
    OracleSystemSettings,
    OracleNotifications,
    OracleNotificationsReadAt,
    OracleExternalIdentityLinks,
    OracleIdentityLinkRequests,
    OracleDocuments,
    OracleTelegramInboundEvents,
    OracleWhatsappInboundEvents,
    OracleNfseEmissions,
    OracleWhatsappAuthState,
  ],
};
