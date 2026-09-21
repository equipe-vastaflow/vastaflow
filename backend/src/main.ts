import 'reflect-metadata';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
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

  // Valida e transforma todo payload de entrada. `forbidNonWhitelisted`
  // rejeita campos nao declarados no DTO, em vez de ignora-los em silencio.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Desligado por padrao. A politica de CORS sera definida na Etapa 4, quando
  // soubermos a origem real do frontend - liberar '*' agora seria um risco
  // desnecessario.
  app.enableCors({ origin: false });

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
        'Esta documentacao cobre apenas o que ja foi implementado. ' +
        'Autenticacao, usuarios, permissoes, auditoria e integracoes externas ' +
        'serao documentados conforme forem construidos.',
    )
    .setVersion('0.1.0')
    .addTag('Health', 'Disponibilidade do servico')
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
