import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IntegrationRegistry } from '../src/modules/integrations/integration-registry';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };

/**
 * Plantae com o ambiente PADRAO: sem nenhuma variavel `PLANTAE_*`. E o estado de
 * quem nao usa o Plantae - a aplicacao tem de subir normalmente e nada pode
 * chamar a rede.
 */
describe('Plantae desabilitado (e2e)', () => {
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

  it('a aplicacao sobe e o resto do sistema funciona', async () => {
    await request(server()).get('/health').expect(200);
    await get('/auth/me').expect(200);
  });

  it('GET /integrations/plantae/status: DISABLED, sem ambiente', async () => {
    const response = await get('/integrations/plantae/status').expect(200);

    expect(response.body).toEqual({
      id: 'plantae',
      name: 'Plantae',
      category: 'OTHER',
      status: 'DISABLED',
      environment: null,
    });
  });

  it.each([
    '/integrations/plantae/me',
    '/integrations/plantae/financial/entries?data_inicio=2026-09-01&data_fim=2026-09-30',
    '/integrations/plantae/financial/accounts',
    '/integrations/plantae/financial/movements?data_inicio=2026-09-01&data_fim=2026-09-30',
    '/integrations/plantae/financial/account-statement?data_inicio=2026-09-01&data_fim=2026-09-30&conta_id=1',
    '/integrations/plantae/fiscal/issued-invoices?data_inicio=2026-09-01&data_fim=2026-09-30',
    '/integrations/plantae/organization/legal-entities',
    '/integrations/plantae/people',
  ])('%s: 424 PLANTAE_DISABLED, e o Plantae NAO e chamado', async (path) => {
    const response = await get(path).expect(424);

    expect((response.body as { message: string }).message).toMatch(/^PLANTAE_DISABLED: /);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a integracao aparece no registro como DISABLED, e o health nem tenta a rede', async () => {
    const registry = app.get(IntegrationRegistry, { strict: false });

    const report = await registry.healthCheck('plantae');

    expect(report).toMatchObject({ status: 'DISABLED', health: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
