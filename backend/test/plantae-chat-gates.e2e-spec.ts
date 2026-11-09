import { GATES_KEY_E2E } from './support/plantae-chat-gates-env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { ExternalIdentityResponseDto } from '../src/modules/external-identities/dto/external-identity-response.dto';
import type { CreatedLinkRequestResponseDto } from '../src/modules/external-identities/dto/link-request.dto';
import { TelegramAdapter } from '../src/modules/integrations/telegram/telegram.adapter';
import {
  signEnvelope,
  type TelegramEnvelope,
} from '../src/modules/integrations/telegram/telegram-envelope';
import {
  CONTAS_PAGAR_MESSAGES,
  CONTAS_RECEBER_MESSAGES,
} from '../src/modules/integrations/plantae/plantae-accounts-payable.command';
import { RoleName } from '../src/modules/roles/role-name.enum';
import {
  addCredential,
  EMPTY_CREDENTIALS_FILE,
} from '../src/modules/service-auth/service-credentials.admin';
import { serializeCredentialsFile } from '../src/modules/service-auth/service-credentials.file';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const ROTA = '/service/telegram/ingest';

interface Resposta {
  outcome: string;
  duplicate: boolean;
  reply: string | null;
}

/**
 * Portoes do `/contas_pagar` (Fase 6), na aplicacao completa e com o estado SEGURO: comando de chat
 * ligado, Plantae desligado e organizacao NAO confirmada. Em nenhum cenario o Plantae e chamado.
 */
describe('Portoes do comando financeiro no chat (e2e)', () => {
  let app: INestApplication;
  let dir: string;
  let tokenIngest: string;
  let tokenIdentity: string;
  let adminJwt: string;
  let adminId: string;
  let operadorId: string;
  let adminTg: string;
  let operadorTg: string;
  let linkAdminId: string;
  let fetchSpy: jest.SpyInstance<
    Promise<Response>,
    [input: string | URL | Request, init?: RequestInit]
  >;
  let seq = 5000;
  let tgSeq = 830_000_000;

  const server = (): Server => app.getHttpServer() as Server;
  const novoTg = (): string => String(++tgSeq);

  function envelope(userId: string, text: string): TelegramEnvelope {
    return {
      version: 'v1',
      platform: 'telegram',
      botId: '123456789',
      updateId: ++seq,
      messageId: 1,
      chatId: userId,
      userId,
      chatType: 'private',
      text,
      sentAt: Math.floor(Date.now() / 1000),
      issuedAt: Date.now(),
    };
  }

  const enviar = (userId: string, text: string, token = tokenIngest): request.Test => {
    const env = envelope(userId, text);
    return request(server())
      .post(ROTA)
      .set('X-Service-Token', token)
      .send({ envelope: env, signature: signEnvelope(env, GATES_KEY_E2E) });
  };

  async function ingerir(userId: string, text: string): Promise<Resposta> {
    return (await enviar(userId, text).expect(200)).body as Resposta;
  }

  async function vincular(userId: string, telegramId: string): Promise<void> {
    const criada = await request(server())
      .post(`/users/${userId}/external-identities/link-requests`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ canal: 'telegram' })
      .expect(201);
    const { codigo } = criada.body as CreatedLinkRequestResponseDto;
    const r = await app.get(TelegramAdapter, { strict: false }).processMessage({
      channel: 'telegram',
      conversationId: telegramId,
      sender: { channel: 'telegram', externalId: telegramId },
      text: `/vincular ${codigo}`,
      receivedAt: new Date(),
    });
    expect(r.outcome).toBe('LINK_CONFIRMED');
  }

  async function auditoria(acao: string): Promise<AuditLogPageResponseDto['items']> {
    const r = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    return (r.body as AuditLogPageResponseDto).items.filter((i) => i.acao === acao);
  }

  const chamadasAoPlantae = (): number =>
    fetchSpy.mock.calls.filter(([input]) =>
      /plantae/i.test(
        String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url),
      ),
    ).length;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-gates-e2e-'));
    const a = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-telegram-g',
      principal: 'n8n-telegram',
      now: new Date(),
    });
    tokenIngest = a.token;
    const b = addCredential(a.file, { id: 'n8n-g', principal: 'n8n', now: new Date() });
    tokenIdentity = b.token;
    const arquivo = join(dir, 'credentials.json');
    writeFileSync(arquivo, serializeCredentialsFile(b.file));
    process.env.SERVICE_CREDENTIALS_FILE = arquivo;

    fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockRejectedValue(new Error('nenhuma chamada de rede esperada'));
    app = await createTestApp();

    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminJwt = (login.body as AuthResponseDto).accessToken;
    adminId = (login.body as AuthResponseDto).user.id;
    const operador = await app.get(UsersService, { strict: false }).create({
      nome: 'Operador G',
      email: 'operador@gates.test',
      senha: SENHA,
      role: RoleName.Operador,
    });
    operadorId = operador.id;
    adminTg = novoTg();
    operadorTg = novoTg();
    await vincular(adminId, adminTg);
    await vincular(operadorId, operadorTg);
    const vinculos = await request(server())
      .get(`/users/${adminId}/external-identities`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    linkAdminId = (vinculos.body as ExternalIdentityResponseDto[])[0]?.id ?? '';
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await app.close();
    delete process.env.SERVICE_CREDENTIALS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchSpy.mockClear();
  });

  it('ADMIN vinculado, tudo ligado MENOS a organizacao confirmada: bloqueado, Plantae nao e chamado', async () => {
    const out = await ingerir(adminTg, '/contas_pagar');

    expect(out.outcome).toBe('FAILED');
    expect(out.reply).toBe(CONTAS_PAGAR_MESSAGES.organizationNotConfirmed);
    expect(chamadasAoPlantae()).toBe(0);
  });

  it('a auditoria registra QUEM (a pessoa), o canal e o MOTIVO do bloqueio, sem conteudo', async () => {
    await ingerir(adminTg, '/contas_pagar');

    const eventos = await auditoria('PLANTAE_QUERIED');
    const meu = eventos.find((e) => e.usuarioId === adminId);
    expect(meu?.metadados).toMatchObject({
      comando: 'contas_pagar',
      canal: 'telegram',
      detalhe: 'organizacao_nao_confirmada',
    });
    expect(meu?.metadados).not.toHaveProperty('conversationId');
    expect(JSON.stringify(eventos)).not.toContain(adminTg);
  });

  it('OPERADOR vinculado: negado pelo RBAC ANTES do comando - sem Plantae e sem evento financeiro dele', async () => {
    const antes = (await auditoria('PLANTAE_QUERIED')).filter(
      (e) => e.usuarioId === operadorId,
    ).length;

    const out = await ingerir(operadorTg, '/contas_pagar');

    expect(out.outcome).toBe('DENIED');
    expect(out.reply).not.toContain('Contas a pagar');
    expect(chamadasAoPlantae()).toBe(0);
    const depois = (await auditoria('PLANTAE_QUERIED')).filter(
      (e) => e.usuarioId === operadorId,
    ).length;
    expect(depois).toBe(antes);
  });

  it('usuario NAO vinculado: UNLINKED, nada consultado', async () => {
    const out = await ingerir(novoTg(), '/contas_pagar');

    expect(out.outcome).toBe('UNLINKED');
    expect(chamadasAoPlantae()).toBe(0);
  });

  it('o servico nao e ator: token de servico sem o escopo do Telegram e recusado (403)', async () => {
    await enviar(adminTg, '/contas_pagar', tokenIdentity).expect(403);
    expect(chamadasAoPlantae()).toBe(0);
  });

  describe('/contas_receber passa pelos MESMOS portoes', () => {
    it('organizacao nao confirmada: bloqueado, Plantae nao e chamado, auditado com o comando', async () => {
      const out = await ingerir(adminTg, '/contas_receber');

      expect(out.outcome).toBe('FAILED');
      expect(out.reply).toBe(CONTAS_RECEBER_MESSAGES.organizationNotConfirmed);
      expect(chamadasAoPlantae()).toBe(0);
      const eventos = await auditoria('PLANTAE_QUERIED');
      expect(
        eventos.find((e) => e.usuarioId === adminId && e.metadados?.comando === 'contas_receber')
          ?.metadados,
      ).toMatchObject({ canal: 'telegram', detalhe: 'organizacao_nao_confirmada' });
    });

    it('OPERADOR vinculado sem plantae:read: negado pelo RBAC, sem Plantae', async () => {
      const out = await ingerir(operadorTg, '/contas_receber');

      expect(out.outcome).toBe('DENIED');
      expect(out.reply).not.toContain('Contas a receber');
      expect(chamadasAoPlantae()).toBe(0);
    });

    it('usuario NAO vinculado: UNLINKED, nada consultado', async () => {
      const out = await ingerir(novoTg(), '/contas_receber');

      expect(out.outcome).toBe('UNLINKED');
      expect(chamadasAoPlantae()).toBe(0);
    });

    it('token de servico sem o escopo do Telegram: 403', async () => {
      await enviar(adminTg, '/contas_receber', tokenIdentity).expect(403);
      expect(chamadasAoPlantae()).toBe(0);
    });
  });

  it('vinculo REVOGADO corta o acesso na mensagem seguinte (pagar e receber)', async () => {
    await request(server())
      .delete(`/users/${adminId}/external-identities/${linkAdminId}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(204);

    const out = await ingerir(adminTg, '/contas_pagar');
    const receber = await ingerir(adminTg, '/contas_receber');

    expect(out.outcome).toBe('UNLINKED');
    expect(receber.outcome).toBe('UNLINKED');
    expect(chamadasAoPlantae()).toBe(0);
  });
});
