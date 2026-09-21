import type { Server } from 'node:http';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { ErrorResponseDto } from '../src/common/dto/error-response.dto';
import type { HealthResponseDto } from '../src/modules/health/dto/health-response.dto';

describe('Health (e2e)', () => {
  let app: INestApplication;

  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health devolve exatamente o contrato definido no briefing', async () => {
    const response = await request(server()).get('/health').expect(200);
    const body = response.body as HealthResponseDto;

    expect(body).toEqual({
      status: 'ok',
      service: 'vasta-flow',
    });
  });

  it('rota inexistente responde no formato padronizado de erro', async () => {
    const response = await request(server()).get('/rota-que-nao-existe').expect(404);
    const body = response.body as ErrorResponseDto;

    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/rota-que-nao-existe',
    });
    expect(typeof body.timestamp).toBe('string');
    // `incidentId` so aparece em erros 5xx.
    expect(body.incidentId).toBeUndefined();
  });
});
