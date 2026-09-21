import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';

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

    HealthModule,

    // Modulos das proximas etapas:
    //   Etapa 2 - DatabaseModule (TypeORM: MySQL | Oracle)
    //   Etapa 3 - AuthModule, UsersModule, RolesModule, PermissionsModule, AuditModule
    //   Etapa 5 - IntegrationsModule (apenas contratos)
  ],
})
export class AppModule {}
