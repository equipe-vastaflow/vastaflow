import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { SeedModule } from './database/seed/seed.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
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

    // Modulos das proximas etapas:
    //   Etapa 5 - IntegrationsModule (apenas contratos)
  ],
})
export class AppModule {}
