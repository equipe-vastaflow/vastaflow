import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { SeedModule } from './database/seed/seed.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommandsModule } from './modules/commands/commands.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ExternalIdentitiesModule } from './modules/external-identities/external-identities.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './modules/health/health.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { TelegramModule } from './modules/integrations/telegram/telegram.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // O `.env` fica na raiz do backend. Em producao as variaveis costumam vir
      // do proprio ambiente/orquestrador, e nesse caso o arquivo simplesmente
      // nao existe - o `validateEnv` continua garantindo o contrato.
      envFilePath: ['.env'],
      validate: validateEnv,
    }),

    DatabaseModule,
    HealthModule,

    // Usuarios, autenticacao, autorizacao (RBAC) e auditoria.
    PermissionsModule,
    RolesModule,
    UsersModule,
    AuditModule,
    AuthModule,
    SeedModule,

    // Agrega os indicadores dos modulos acima. Nao tem dados proprios.
    DashboardModule,

    // Configuracoes internas, administradas por ADMIN. Nao guardam segredo.
    SettingsModule,

    // Avisos internos por usuario. Sem integracao externa: nada de e-mail,
    // push ou mensageria - os modulos de negocio chamam o service direto.
    NotificationsModule,

    // Primeiro dominio de negocio.
    FinanceModule,

    // Nucleo do motor de comandos. Independe de canal: os adaptadores
    // (Telegram, WhatsApp) entrarao como modulos proprios que o importam.
    CommandsModule,

    // Foundation das integracoes externas: contrato, estados e registro.
    // Nenhuma integracao real, nenhuma rota e nenhuma chamada externa.
    IntegrationsModule,

    // Vinculos entre contas externas (Telegram) e usuarios internos. Fornece o
    // resolvedor de identidade que os canais consomem.
    ExternalIdentitiesModule,

    // Canal Telegram: adapter do Command Engine. Sem rota HTTP; o recebimento
    // por polling e opt-in (TELEGRAM_POLLING_ENABLED) e exige o token.
    TelegramModule,
  ],
})
export class AppModule {}
