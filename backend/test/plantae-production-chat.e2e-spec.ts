import './support/plantae-production-chat-env';
import type { Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import {
  HOMOLOGATION_BANNER,
  PRODUCTION_BANNER,
} from '../src/modules/integrations/plantae/plantae-accounts-payable.command';
import { CommandRouter } from '../src/modules/commands/command-router.service';
import { CommandChannel } from '../src/modules/commands/command.types';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { entryJson, jsonResponse, listJson } from './support/plantae-fixtures';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };

function urlDe(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/**
 * `/contas_pagar` com o host de PRODUCAO, o comando de chat ligado e o atestado dado (o estado em que ele responde).
 * `fetch` SIMULADO, token FALSO: nenhuma chamada real. Prova que a resposta nunca e rotulada de homologacao.
 */
describe('/contas_pagar em producao (web.plantae.agr.br) - e2e', () => {
  let app: INestApplication;
  let adminUser: AuthResponseDto['user'];
  let operadorUser: AuthResponseDto['user'];
  let fetchSpy: jest.SpyInstance<
    Promise<Response>,
    [input: string | URL | Request, init?: RequestInit]
  >;

  const server = (): Server => app.getHttpServer() as Server;
  const executar = (
    user: AuthResponseDto['user'],
    text = '/contas_pagar',
  ): Promise<{ reply: string; success: boolean }> =>
    app.get(CommandRouter, { strict: false }).execute({
      user,
      conversationId: '555',
      channel: CommandChannel.Telegram,
      text,
    });

  beforeAll(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp();
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminUser = (login.body as AuthResponseDto).user;
    const email = 'operador@prod-chat.test';
    await app.get(UsersService, { strict: false }).create({
      nome: 'Operador',
      email,
      senha: 'Senha1234',
      role: RoleName.Operador,
    });
    const op = await request(server())
      .post('/auth/login')
      .send({ email, senha: 'Senha1234' })
      .expect(200);
    operadorUser = (op.body as AuthResponseDto).user;
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse(listJson([entryJson(482)], { nextCursor: null }))),
    );
  });

  it('ADMIN: consulta SO o host de producao e a primeira linha e o aviso de PRODUCAO', async () => {
    const r = await executar(adminUser);

    expect(r.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL(urlDe(fetchSpy.mock.calls[0]?.[0] ?? ''));
    expect(url.hostname).toBe('web.plantae.agr.br');
    expect(url.pathname).toBe('/api/v1/external/financial/entries');
    expect(url.searchParams.get('tipo')).toBe('despesa');
    expect(url.searchParams.getAll('status[]')).toEqual(['0']);
    expect(r.reply.split(String.fromCharCode(10))[0]).toBe(PRODUCTION_BANNER);
  });

  it('a resposta NUNCA e rotulada de homologacao nem traz dado pessoal', async () => {
    const r = await executar(adminUser);

    expect(r.reply).not.toContain(HOMOLOGATION_BANNER);
    expect(r.reply).not.toMatch(/HOMOLOGACAO|dados de teste/i);
    expect(r.reply).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(r.reply).not.toMatch(/DESCRICAO|OBSERVACAO|DOC-/);
  });

  it('OPERADOR: negado ANTES do handler, o Plantae nao e chamado', async () => {
    const r = await executar(operadorUser);

    expect(r.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('argumento invalido: orientacao de uso, sem consultar o Plantae', async () => {
    const r = await executar(adminUser, '/contas_pagar 2026-13-45 abc');

    expect(r.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falha do Plantae em producao: frase fixa, sem valores e sem o token', async () => {
    fetchSpy.mockResolvedValue(jsonResponse('{"message":"erro"}', { status: 500 }));

    const r = await executar(adminUser);

    expect(r.success).toBe(false);
    expect(r.reply).not.toMatch(/R\$|\d+,\d{2}/);
    expect(r.reply).not.toContain('plt_');
  });
});
