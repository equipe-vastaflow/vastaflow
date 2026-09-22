// Precisa vir antes de `./support/test-app`, que alcanca o AppModule e congela
// o ambiente validado. Ver o comentario em `production-env.ts`.
import './support/production-env';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CommandResultResponseDto } from '../src/modules/commands/dto/command-result-response.dto';
import { createTestApp } from './support/test-app';

/**
 * O endpoint interno `POST /commands/execute` em producao.
 *
 * Suite separada de proposito: o ambiente validado e fixado uma unica vez por
 * processo, e o Jest da a cada arquivo de teste o seu proprio registro de
 * modulos. As demais suites seguem em `NODE_ENV=test`.
 */
const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const ENDPOINT = '/commands/execute';

describe('Commands em producao (e2e)', () => {
  let app: INestApplication;
  let token: string;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (value: string): string => `Bearer ${value}`;

  beforeAll(async () => {
    app = await createTestApp();

    const response = await request(server())
      .post('/auth/login')
      .send({ email: ADMIN.email, senha: ADMIN.senha })
      .expect(200);
    token = (response.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a rota responde 404 mesmo para um ADMIN autenticado', async () => {
    await request(server())
      .post(ENDPOINT)
      .set('Authorization', bearer(token))
      .send({ text: '/ajuda' })
      .expect(404);
  });

  it('nenhum comando e executado: a resposta nao tem corpo de resultado', async () => {
    const response = await request(server())
      .post(ENDPOINT)
      .set('Authorization', bearer(token))
      .send({ text: '/status' })
      .expect(404);

    const body = response.body as Partial<CommandResultResponseDto>;
    expect(body.reply).toBeUndefined();
    expect(body.success).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('Motor de comandos operacional');
  });

  it('bloqueia antes de validar o corpo - nem um payload invalido revela a rota', async () => {
    await request(server())
      .post(ENDPOINT)
      .set('Authorization', bearer(token))
      .send({ text: '' })
      .expect(404);
  });

  it('a resposta tem a mesma forma de um 404 de rota inexistente', async () => {
    const inexistente = await request(server())
      .post('/rota-que-nao-existe')
      .set('Authorization', bearer(token))
      .send({ text: '/ajuda' })
      .expect(404);
    const bloqueada = await request(server())
      .post(ENDPOINT)
      .set('Authorization', bearer(token))
      .send({ text: '/ajuda' })
      .expect(404);

    const real = inexistente.body as { message: string };
    const nossa = bloqueada.body as { message: string };

    expect(Object.keys(nossa).sort()).toEqual(Object.keys(real).sort());
    // Mesma mensagem que o Nest produz para uma rota que nao existe, trocado
    // apenas o caminho: para quem chama, a rota simplesmente nao esta la.
    expect(nossa.message).toBe(real.message.replace('/rota-que-nao-existe', ENDPOINT));
  });

  it('sem token responde 401: o guard global de autenticacao roda primeiro', async () => {
    // Documenta a ordem real dos guards (globais antes dos de controller). Nao
    // enfraquece o bloqueio - nenhuma requisicao, autenticada ou nao, executa
    // comando em producao -, mas a rota nao fica indistinguivel de uma
    // inexistente para quem sonda sem credencial.
    await request(server()).post(ENDPOINT).send({ text: '/ajuda' }).expect(401);
  });

  it('nao vaza o motivo do bloqueio', async () => {
    const response = await request(server())
      .post(ENDPOINT)
      .set('Authorization', bearer(token))
      .send({ text: '/ajuda' })
      .expect(404);

    expect(JSON.stringify(response.body)).not.toMatch(/producao|production|NODE_ENV|ambiente/i);
  });

  it('as demais rotas continuam funcionando normalmente', async () => {
    await request(server()).get('/health').expect(200);
    await request(server())
      .get('/dashboard/summary')
      .set('Authorization', bearer(token))
      .expect(200);
    await request(server()).get('/audit-logs').set('Authorization', bearer(token)).expect(200);
    await request(server()).get('/users').set('Authorization', bearer(token)).expect(200);
  });

  it('a rota continua registrada: o que a torna indisponivel e o 404, nao o Swagger', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());

    // O controller continua registrado (o bloqueio e em tempo de requisicao),
    // entao a rota aparece - o que garante a indisponibilidade e o 404 acima,
    // nao a ausencia na documentacao.
    expect(Object.keys(document.paths)).toContain(ENDPOINT);
  });
});
