import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AuditModule } from '../audit/audit.module';
import { ServiceAuthGuard } from '../service-auth/service-auth.guard';
import { ServiceAuthModule } from '../service-auth/service-auth.module';
import { UsersModule } from '../users/users.module';
import { parseDurationToSeconds } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    ServiceAuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: parseDurationToSeconds(config.get('JWT_EXPIRES_IN', { infer: true })),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Guards globais. A ordem importa: servico -> autentica -> perfil -> permissao.
    //
    // O guard de SERVICO vem primeiro e so age em rotas `@ServiceRoute`; em toda
    // outra rota devolve `true` sem olhar a requisicao. O `JwtAuthGuard` que vem
    // depois, numa rota de servico, apenas confirma que ele autenticou - entao
    // trocar esta ordem ou remover o guard de servico faz as rotas de servico
    // darem 401, nunca ficarem abertas.
    { provide: APP_GUARD, useClass: ServiceAuthGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
