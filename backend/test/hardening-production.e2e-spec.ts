// Precisa vir antes de `./support/test-app`, que alcanca o AppModule e congela
// o ambiente validado. Ver o comentario em `production-env.ts`.
import './support/production-env';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { UserPageResponseDto } from '../src/modules/users/dto/user-page-response.dto';
import { createTestApp } from './support/test-app';

/**
 * Hardening com a aplicacao rodando de fato em `NODE_ENV=production`.
 *
 * Suite separada pelo mesmo motivo de `commands-production.e2e-spec.ts`: o
 * ambiente validado e fixado uma unica vez por processo, e o Jest da a cada
 * arquivo o seu proprio registro de modulos.
 */
const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const ENDPOINT = '/auth/register';

const NOVO_USUARIO = {
  nome: 'Pessoa de Fora',
  email: 'pessoa-de-fora@vasta.test',
  senha: 'Senha1234',
};

describe('Hardening em producao (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (value: string): string => `Bearer ${value}`;

  beforeAll(async () => {
    app = await createTestApp();

    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = (login.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('cadastro publico', () => {
    it('a aplicacao sobe em producao com a configuracao exigida', () => {
      // O proprio boot e a evidencia: a validacao de ambiente recusaria
      // `DATABASE_SSL` ausente ou `SWAGGER_ENABLED=true` em producao.
      expect(app).toBeDefined();
    });

    it('responde 404, como se a rota nao existisse', async () => {
      await request(server()).post(ENDPOINT).send(NOVO_USUARIO).expect(404);
    });

    it('nenhum usuario e criado', async () => {
      await request(server()).post(ENDPOINT).send(NOVO_USUARIO).expect(404);

      const pagina = await request(server())
        .get('/users')
        .query({ limit: '100' })
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const emails = (pagina.body as UserPageResponseDto).items.map((item) => item.email);
      expect(emails).not.toContain(NOVO_USUARIO.email);
    });

    it('nenhum token de acesso e devolvido', async () => {
      const resposta = await request(server()).post(ENDPOINT).send(NOVO_USUARIO).expect(404);

      const corpo = resposta.body as Partial<AuthResponseDto>;
      expect(corpo.accessToken).toBeUndefined();
      expect(corpo.user).toBeUndefined();
    });

    it('bloqueia ANTES de validar o corpo: payload invalido nao revela o formato esperado', async () => {
      // O guard roda antes do ValidationPipe, entao a resposta e a mesma de um
      // corpo valido - nada se aprende sobre os campos aceitos.
      const invalido = await request(server())
        .post(ENDPOINT)
        .send({ campo: 'inexistente' })
        .expect(404);

      expect((invalido.body as { message: string }).message).toBe('Cannot POST /auth/register');
    });

    it('corpo vazio tambem responde 404', async () => {
      await request(server()).post(ENDPOINT).send({}).expect(404);
    });

    it('a resposta tem a mesma forma de um 404 de rota inexistente', async () => {
      const inexistente = await request(server()).post('/rota-que-nao-existe').expect(404);
      const bloqueada = await request(server()).post(ENDPOINT).send(NOVO_USUARIO).expect(404);

      const real = inexistente.body as { message: string };
      const nossa = bloqueada.body as { message: string };

      expect(Object.keys(nossa).sort()).toEqual(Object.keys(real).sort());
      expect(nossa.message).toBe(real.message.replace('/rota-que-nao-existe', ENDPOINT));
    });

    it('nao vaza o motivo do bloqueio', async () => {
      const resposta = await request(server()).post(ENDPOINT).send(NOVO_USUARIO).expect(404);

      const corpo = JSON.stringify(resposta.body);
      expect(corpo).not.toMatch(/producao|production|desabilit|bloque|administrador|cadastro/i);
      expect(corpo).not.toContain('incidentId');
    });
  });

  describe('o resto da aplicacao segue funcionando em producao', () => {
    it('login continua disponivel', async () => {
      await request(server()).post('/auth/login').send(ADMIN).expect(200);
    });

    it('/auth/me continua disponivel', async () => {
      await request(server()).get('/auth/me').set('Authorization', bearer(adminToken)).expect(200);
    });

    it('criacao administrativa de usuario continua disponivel', async () => {
      // O caminho correto para criar conta em producao.
      const criado = await request(server())
        .post('/users')
        .set('Authorization', bearer(adminToken))
        .send({
          nome: 'Criado Pelo Admin',
          email: 'criado-pelo-admin@vasta.test',
          senha: 'Senha1234',
          role: 'USUARIO',
        })
        .expect(201);

      expect((criado.body as { email: string }).email).toBe('criado-pelo-admin@vasta.test');
    });

    it('o liveness continua publico', async () => {
      await request(server()).get('/health').expect(200);
    });

    it('o readiness continua publico e respondendo', async () => {
      const resposta = await request(server()).get('/health/readiness').expect(200);

      expect((resposta.body as { status: string }).status).toBe('ok');
    });

    it('rota protegida sem token segue respondendo 401', async () => {
      await request(server()).get('/users').expect(401);
    });
  });
});
