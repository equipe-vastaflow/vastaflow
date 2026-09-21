import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ErrorResponseDto } from '../src/common/dto/error-response.dto';
import type { HealthResponseDto } from '../src/modules/health/dto/health-response.dto';
import { createTestApp } from './support/test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    app = await createTestApp();
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

  it('GET /health continua publico mesmo com o guard de autenticacao global', async () => {
    // Sem header Authorization: se o guard global barrasse, seria 401.
    await request(server()).get('/health').expect(200);
  });

  it('rota inexistente responde no formato padronizado de erro', async () => {
    // Rota inexistente nao passa por guard: o roteador responde 404 antes.
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
