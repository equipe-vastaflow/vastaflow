import 'reflect-metadata';
import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ErrorResponseDto } from './common/dto/error-response.dto';
import { Environment, type EnvironmentVariables } from './config/env.validation';

const SWAGGER_PATH = 'docs';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const appName = configService.get('APP_NAME', { infer: true });
  const port = configService.get('PORT', { infer: true });
  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  const swaggerEnabled = configService.get('SWAGGER_ENABLED', { infer: true });

  configureApp(app);

  // Lista explicita de origens (FRONTEND_ORIGIN). Vazio mantem o CORS
  // desligado - nunca liberamos '*'.
  const allowedOrigins = configService
    .get('FRONTEND_ORIGIN', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  app.enableCors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false });

  app.enableShutdownHooks();

  if (swaggerEnabled) {
    setupSwagger(app, appName);
  }

  await app.listen(port);

  logger.log(`${appName} iniciado em modo '${nodeEnv}'`);
  logger.log(`Health check:  http://localhost:${port}/health`);

  if (swaggerEnabled) {
    logger.log(`Documentacao:  http://localhost:${port}/${SWAGGER_PATH}`);
    if (nodeEnv === Environment.Production) {
      logger.warn('SWAGGER_ENABLED=true em producao: a documentacao esta publicamente acessivel.');
    }
  }
}

function setupSwagger(app: INestApplication, appName: string): void {
  const config = new DocumentBuilder()
    .setTitle('VastaFlow API')
    .setDescription(
      'API da plataforma de automacao empresarial da Vasta Participacoes.\n\n' +
        'Esta documentacao cobre apenas o que ja foi implementado: ' +
        'autenticacao, usuarios, controle de acesso (RBAC) e auditoria. ' +
        'Integracoes externas serao documentadas conforme forem construidas.\n\n' +
        'Para testar rotas protegidas, faca login em `POST /auth/login`, copie o ' +
        '`accessToken` e informe-o em **Authorize**.',
    )
    .setVersion('0.1.0')
    .addTag('Health', 'Disponibilidade do servico')
    .addTag('Auth', 'Cadastro, login, sessao e logout')
    .addTag('Users', 'Usuarios')
    .addTag('Audit', 'Trilha de auditoria')
    .addTag('Dashboard', 'Indicadores administrativos, somente leitura')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponseDto],
  });

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    customSiteTitle: `${appName} - API`,
    swaggerOptions: { persistAuthorization: true },
  });
}

void bootstrap();
