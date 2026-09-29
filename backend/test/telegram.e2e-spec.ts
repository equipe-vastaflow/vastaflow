import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CommandResultResponseDto } from '../src/modules/commands/dto/command-result-response.dto';
import {
  IntegrationCategory,
  IntegrationStatus,
} from '../src/modules/integrations/integration.enums';
import { IntegrationRegistry } from '../src/modules/integrations/integration-registry';
import { TelegramPollingService } from '../src/modules/integrations/telegram/telegram-polling.service';
import { createTestApp } from './support/test-app';

/**
 * Canal Telegram na aplicacao COMPLETA, sem token (como em `setup-env.ts`).
 *
 * Prova o que so a aplicacao montada mostra: o modulo sobe junto com os demais
 * sem depender do Telegram, o provider aparece `NOT_CONFIGURED`, nada e
 * chamado na rede, nenhuma rota de webhook foi aberta, o `/health` nao mudou e
 * o shutdown nao deixa polling vivo.
 */
describe('Telegram (e2e)', () => {
  let app: INestApplication;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  const server = (): Server => app.getHttpServer() as Server;

  async function tokenAdmin(): Promise<string> {
    const login = await request(server())
      .post('/auth/login')
      .send({ email: 'admin@vasta.test', senha: 'AdminSenha1' })
      .expect(200);
    return `Bearer ${(login.body as AuthResponseDto).accessToken}`;
  }

  beforeAll(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp();
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await app.close();
  });

  it('sem token, a aplicacao sobe e o polling nao inicia', () => {
    expect(app.get(TelegramPollingService, { strict: false }).isRunning()).toBe(false);
  });

  it('o provider esta registrado como NOT_CONFIGURED, sem health check', async () => {
    const registry = app.get(IntegrationRegistry, { strict: false });

    await expect(registry.healthCheck('telegram')).resolves.toEqual({
      id: 'telegram',
      name: 'Telegram',
      category: IntegrationCategory.Messaging,
      status: IntegrationStatus.NotConfigured,
      health: null,
    });
  });

  it('nenhuma chamada ao Telegram: nem no boot, nem no status', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('o /health continua exatamente como antes', async () => {
    const response = await request(server()).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'vasta-flow' });
  });

  it('nao existe rota de webhook, publica ou autenticada', async () => {
    const bearer = await tokenAdmin();

    for (const rota of ['/telegram', '/telegram/webhook', '/webhook', '/integrations/telegram']) {
      await request(server()).post(rota).send({ update_id: 1 }).expect(404);
      await request(server()).post(rota).set('Authorization', bearer).send({}).expect(404);
    }
  });

  it('o motor continua o mesmo pelo endpoint de teste (canal test)', async () => {
    const response = await request(server())
      .post('/commands/execute')
      .set('Authorization', await tokenAdmin())
      .send({ text: '/status' })
      .expect(200);

    expect((response.body as CommandResultResponseDto).reply).toContain('Canal: test');
  });

  it('fechar a aplicacao nao deixa polling vivo', async () => {
    const outra = await createTestApp();
    const polling = outra.get(TelegramPollingService, { strict: false });

    await outra.close();

    expect(polling.isRunning()).toBe(false);
  });
});
