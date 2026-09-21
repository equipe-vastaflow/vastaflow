import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Configuracao HTTP compartilhada entre `main.ts` e os testes e2e, para que os
 * testes exercitem exatamente o pipeline de producao.
 */
export function configureApp(app: INestApplication): void {
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
}
