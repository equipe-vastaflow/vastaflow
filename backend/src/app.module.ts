import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { SeedModule } from './database/seed/seed.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommandsModule } from './modules/commands/commands.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './modules/health/health.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
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

    // Primeiro dominio de negocio.
    FinanceModule,

    // Nucleo do motor de comandos. Independe de canal: os adaptadores
    // (Telegram, WhatsApp) entrarao como modulos proprios que o importam.
    CommandsModule,

    // Modulos das proximas etapas:
    //   Etapa 5 - IntegrationsModule (apenas contratos)
  ],
})
export class AppModule {}
