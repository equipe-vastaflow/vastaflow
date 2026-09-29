import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import {
  IntegrationCategory,
  IntegrationStatus,
} from '../src/modules/integrations/integration.enums';
import { IntegrationRegistry } from '../src/modules/integrations/integration-registry';
import type { IntegrationProvider } from '../src/modules/integrations/integration.types';
import { createTestApp } from './support/test-app';

/**
 * Foundation de integracoes dentro da aplicacao COMPLETA.
 *
 * Prova o que so a aplicacao montada mostra: o modulo sobe junto com os
 * demais, nenhum provider (real ou falso) vem registrado, nenhuma rota nova foi
 * exposta, o `/health` nao mudou e o boot nao faz chamada externa.
 */
describe('Integracoes (e2e)', () => {
  let app: INestApplication;
  let registry: IntegrationRegistry;
  let fetchSpy: jest.SpyInstance;

  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    // Antes do boot: qualquer `fetch` durante a inicializacao seria registrado.
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp();
    registry = app.get(IntegrationRegistry, { strict: false });
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await app.close();
  });

  it('a aplicacao sobe sem nenhuma integracao registrada - nem falsa', () => {
    expect(registry.all()).toEqual([]);
  });

  it('o boot nao faz chamada externa', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('o /health continua exatamente como antes', async () => {
    const response = await request(server()).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'vasta-flow' });
  });

  it('nao existe rota HTTP de integracoes, nem para ADMIN', async () => {
    const login = await request(server())
      .post('/auth/login')
      .send({ email: 'admin@vasta.test', senha: 'AdminSenha1' })
      .expect(200);
    const bearer = `Bearer ${(login.body as AuthResponseDto).accessToken}`;

    await request(server()).get('/integrations').set('Authorization', bearer).expect(404);
    await request(server()).get('/integrations/telegram').set('Authorization', bearer).expect(404);
    await request(server())
      .post('/integrations/telegram/health')
      .set('Authorization', bearer)
      .expect(404);
  });

  it('o registro da aplicacao aceita um provider e responde status e health', async () => {
    // Provider de TESTE, registrado so nesta instancia da aplicacao.
    const exemplo: IntegrationProvider = {
      metadata: { id: 'exemplo-e2e', name: 'Exemplo', category: IntegrationCategory.Other },
      getStatus: () => Promise.resolve(IntegrationStatus.Ready),
      healthCheck: () => Promise.resolve({ status: 'ok', detail: 'respondendo' }),
    };

    registry.register(exemplo);

    expect(registry.all()).toEqual([
      { id: 'exemplo-e2e', name: 'Exemplo', category: IntegrationCategory.Other },
    ]);
    await expect(registry.healthCheck('exemplo-e2e')).resolves.toMatchObject({
      status: IntegrationStatus.Ready,
      // O `detail` do provider ('respondendo') nao sai: a mensagem e do registro.
      health: { status: 'ok', detail: 'disponivel' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
