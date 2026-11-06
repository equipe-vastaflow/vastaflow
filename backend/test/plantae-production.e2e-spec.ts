import './support/plantae-production-env';
import type { Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { CommandRouter } from '../src/modules/commands/command-router.service';
import { CommandChannel } from '../src/modules/commands/command.types';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import {
  accountJson,
  entryJson,
  FAKE_TOKEN,
  jsonResponse,
  legalEntityJson,
  listJson,
  ME_JSON,
  personJson,
} from './support/plantae-fixtures';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const BASE = '/integrations/plantae';
const PERIODO = 'data_inicio=2026-09-01&data_fim=2026-09-30';
const HOST_PRODUCAO = 'web.plantae.agr.br';

function urlDe(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function corpoPara(upstreamPath: string): string {
  switch (upstreamPath) {
    case '/me':
      return ME_JSON;
    case '/financial/entries':
      return listJson([entryJson(482)], { nextCursor: null });
    case '/financial/accounts':
      return listJson([accountJson()], { endpoint: 'financial/accounts' });
    case '/organization/legal-entities':
      return listJson([legalEntityJson()], { endpoint: 'organization/legal-entities' });
    default:
      return listJson([personJson()], { endpoint: 'people', withLinks: false, withMeta: false });
  }
}

/**
 * Plantae no host de PRODUCAO (`web.plantae.agr.br`), na aplicacao completa, com `fetch` SIMULADO e token FALSO: nenhuma
 * chamada real. O comando de chat e o atestado da organizacao ficam no padrao (desligados).
 */
describe('Plantae em producao (web.plantae.agr.br) - e2e', () => {
  let app: INestApplication;
  let adminJwt: string;
  let adminUser: AuthResponseDto['user'];
  let operadorJwt: string;
  let operadorUser: AuthResponseDto['user'];
  let usuarioJwt: string;
  let fetchSpy: jest.SpyInstance<
    Promise<Response>,
    [input: string | URL | Request, init?: RequestInit]
  >;

  const server = (): Server => app.getHttpServer() as Server;
  const como = (jwt: string, path: string): request.Test =>
    request(server()).get(path).set('Authorization', `Bearer ${jwt}`);
  const admin = (path: string): request.Test => como(adminJwt, path);
  const chamadas = (): URL[] => fetchSpy.mock.calls.map(([input]) => new URL(urlDe(input)));

  async function entrar(
    role: RoleName,
    n: number,
  ): Promise<{ jwt: string; user: AuthResponseDto['user'] }> {
    const email = `${role.toLowerCase()}${String(n)}@prod.test`;
    await app
      .get(UsersService, { strict: false })
      .create({ nome: `Teste ${role}`, email, senha: SENHA, role });
    const login = await request(server())
      .post('/auth/login')
      .send({ email, senha: SENHA })
      .expect(200);
    const body = login.body as AuthResponseDto;
    return { jwt: body.accessToken, user: body.user };
  }

  beforeAll(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp();
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    const body = login.body as AuthResponseDto;
    adminJwt = body.accessToken;
    adminUser = body.user;
    const operador = await entrar(RoleName.Operador, 1);
    operadorJwt = operador.jwt;
    operadorUser = operador.user;
    usuarioJwt = (await entrar(RoleName.Usuario, 2)).jwt;
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(corpoPara(new URL(urlDe(input)).pathname.replace('/api/v1/external', ''))),
      ),
    );
  });

  describe('status (local)', () => {
    it('READY, ambiente "production", sem chamar o Plantae e sem expor URL nem token', async () => {
      const response = await admin(`${BASE}/status`).expect(200);

      expect(response.body).toEqual({
        id: 'plantae',
        name: 'Plantae',
        category: 'OTHER',
        status: 'READY',
        environment: 'production',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain(FAKE_TOKEN);
      expect(JSON.stringify(response.body)).not.toContain('plantae.agr.br');
      expect(JSON.stringify(response.body)).not.toMatch(/homolog/i);
    });
  });

  describe('consultas: SO o host de producao, em HTTPS, so GET, com Bearer', () => {
    it.each([
      ['me', `${BASE}/me`, '/me'],
      ['entries', `${BASE}/financial/entries?${PERIODO}`, '/financial/entries'],
      ['accounts', `${BASE}/financial/accounts`, '/financial/accounts'],
      ['legal-entities', `${BASE}/organization/legal-entities`, '/organization/legal-entities'],
      ['people', `${BASE}/people`, '/people'],
    ])('%s', async (_nome, path, upstream) => {
      await admin(path).expect(200);

      const [alvo] = chamadas();
      expect(chamadas()).toHaveLength(1);
      expect(alvo?.protocol).toBe('https:');
      expect(alvo?.hostname).toBe(HOST_PRODUCAO);
      expect(alvo?.pathname).toBe(`/api/v1/external${upstream}`);
      const [, init] = fetchSpy.mock.calls[0] ?? [];
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${FAKE_TOKEN}` });
    });

    it('nenhuma chamada vai a outro host (nem ao de homologacao)', async () => {
      await admin(`${BASE}/me`).expect(200);
      await admin(`${BASE}/people`).expect(200);

      expect(new Set(chamadas().map((u) => u.hostname))).toEqual(new Set([HOST_PRODUCAO]));
    });

    it('redirecionamento do servidor NAO e seguido: erro, uma unica chamada, sem token em outro host', async () => {
      fetchSpy.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://rc.plantae.agr.br/api/v1/external/me' },
        }),
      );

      const response = await admin(`${BASE}/me`);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(chamadas().map((u) => u.hostname)).toEqual([HOST_PRODUCAO]);
      expect(JSON.stringify(response.body)).not.toContain(FAKE_TOKEN);
    });

    it('403 do Plantae (token sem o escopo): erro claro, sem presumir permissao e sem repetir', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"message":"Forbidden"}', { status: 403 }));

      const response = await admin(`${BASE}/financial/entries?${PERIODO}`);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(response.body)).not.toContain(FAKE_TOKEN);
    });
  });

  describe('bloqueios de acesso: o Plantae NAO e chamado', () => {
    it('sem autenticacao: 401', async () => {
      await request(server()).get(`${BASE}/me`).expect(401);
      await request(server()).get(`${BASE}/status`).expect(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('OPERADOR e USUARIO: 403 em todas as rotas', async () => {
      for (const jwt of [operadorJwt, usuarioJwt]) {
        for (const path of [
          `${BASE}/me`,
          `${BASE}/people`,
          `${BASE}/financial/entries?${PERIODO}`,
          `${BASE}/status`,
        ]) {
          await como(jwt, path).expect(403);
        }
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rota de servico e credencial de servico nao abrem estas rotas', async () => {
      await request(server())
        .get(`${BASE}/me`)
        .set('X-Service-Token', `vfs_${'A'.repeat(43)}`)
        .expect(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('nao existe rota de escrita para o Plantae', async () => {
      for (const metodo of ['post', 'put', 'patch', 'delete'] as const) {
        const response = await request(server())
          [metodo](`${BASE}/financial/entries`)
          .set('Authorization', `Bearer ${adminJwt}`)
          .send({});
        expect([404, 405]).toContain(response.status);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('auditoria', () => {
    it('registra o ambiente "production" (nunca "homologation"), sem token nem conteudo', async () => {
      await admin(`${BASE}/people?busca=SEGREDO-DE-BUSCA`).expect(200);
      await admin(`${BASE}/me`).expect(200);

      const logs = await admin('/audit-logs?limit=100').expect(200);
      const eventos = (logs.body as AuditLogPageResponseDto).items.filter(
        (i) => i.acao === 'PLANTAE_QUERIED',
      );

      expect(eventos.length).toBeGreaterThanOrEqual(2);
      for (const evento of eventos) {
        expect(evento.metadados).toMatchObject({ ambiente: 'production' });
      }
      const bruto = JSON.stringify(eventos);
      expect(bruto).not.toContain('homologation');
      expect(bruto).not.toContain(FAKE_TOKEN);
      expect(bruto).not.toContain('SEGREDO-DE-BUSCA');
    });
  });

  describe('comando de chat: DESLIGADO por padrao, tambem em producao', () => {
    const executar = (
      user: AuthResponseDto['user'],
    ): Promise<{ reply: string; success: boolean }> =>
      app.get(CommandRouter, { strict: false }).execute({
        user,
        conversationId: '555',
        channel: CommandChannel.Telegram,
        text: '/contas_pagar',
      });

    it('ADMIN: o comando responde que esta desligado e o Plantae NAO e chamado', async () => {
      const r = await executar(adminUser);

      expect(r.success).toBe(false);
      expect(r.reply).not.toMatch(/R\$|\d+,\d{2}/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('OPERADOR: negado antes do handler, sem Plantae', async () => {
      const r = await executar(operadorUser);

      expect(r.success).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
