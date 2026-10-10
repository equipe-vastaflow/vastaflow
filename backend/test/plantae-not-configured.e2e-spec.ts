import './support/plantae-not-configured-env';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };

/** Plantae HABILITADO, mas sem token: a aplicacao sobe e a integracao fica `NOT_CONFIGURED`. */
describe('Plantae sem token (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let fetchSpy: jest.SpyInstance;

  const server = (): Server => app.getHttpServer() as Server;
  const get = (path: string): request.Test =>
    request(server()).get(path).set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp();
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = (login.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  it('a aplicacao SOBE (a falta do token nao derruba nada)', async () => {
    await request(server()).get('/health').expect(200);
  });

  it('status: NOT_CONFIGURED, mas o ambiente e conhecido', async () => {
    const response = await get('/integrations/plantae/status').expect(200);

    expect(response.body).toMatchObject({ status: 'NOT_CONFIGURED', environment: 'homologation' });
  });

  it('consulta: 424 PLANTAE_NOT_CONFIGURED, sem chamar o Plantae', async () => {
    const response = await get('/integrations/plantae/me').expect(424);

    expect((response.body as { message: string }).message).toMatch(/^PLANTAE_NOT_CONFIGURED: /);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a falha de configuracao tambem e auditada, sem expor nada', async () => {
    const logs = await get('/audit-logs?limit=100').expect(200);
    const eventos = (
      logs.body as { items: Array<{ acao: string; metadados: Record<string, unknown> }> }
    ).items.filter((item) => item.acao === 'PLANTAE_QUERIED');

    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos[0]?.metadados).toMatchObject({
      resultado: 'erro',
      codigo: 'PLANTAE_NOT_CONFIGURED',
    });
  });
});
