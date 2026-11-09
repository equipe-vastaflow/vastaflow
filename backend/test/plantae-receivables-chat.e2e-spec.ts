import './support/plantae-production-chat-env';
import type { Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import {
  CHAT_QUERIES_PER_MINUTE,
  CONTAS_PAGAR_MESSAGES,
  CONTAS_RECEBER_MESSAGES,
  PRODUCTION_BANNER,
} from '../src/modules/integrations/plantae/plantae-accounts-payable.command';
import { CommandCatalog } from '../src/modules/commands/command-catalog';
import { CommandRouter } from '../src/modules/commands/command-router.service';
import { CommandChannel } from '../src/modules/commands/command.types';
import { PermissionCode } from '../src/modules/permissions/permission-code.enum';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { RolesService } from '../src/modules/roles/roles.service';
import { UsersService } from '../src/modules/users/users.service';
import { entryJson, jsonResponse, listJson } from './support/plantae-fixtures';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const NL = String.fromCharCode(10);

function urlDe(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/**
 * `/contas_receber` na aplicacao COMPLETA, com o host de PRODUCAO, o comando de chat ligado e o
 * atestado dado. `fetch` SIMULADO, token FALSO: nenhuma chamada real. O GESTOR recebe
 * `plantae:read` no PERFIL, como foi feito em producao.
 */
describe('/contas_receber (e2e, host de producao simulado)', () => {
  let app: INestApplication;
  let adminUser: AuthResponseDto['user'];
  let fetchSpy: jest.SpyInstance<
    Promise<Response>,
    [input: string | URL | Request, init?: RequestInit]
  >;
  let seq = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const executar = (
    user: AuthResponseDto['user'],
    text: string,
  ): Promise<{ reply: string; success: boolean }> =>
    app.get(CommandRouter, { strict: false }).execute({
      user,
      conversationId: '555',
      channel: CommandChannel.Telegram,
      text,
    });

  /** Usuario NOVO (cota propria no limitador por pessoa), ja autenticado. */
  async function novoUsuario(role: RoleName): Promise<AuthResponseDto['user']> {
    seq += 1;
    const email = `${role.toLowerCase()}${String(seq)}@receber.test`;
    await app.get(UsersService, { strict: false }).create({
      nome: `Teste ${role}`,
      email,
      senha: SENHA,
      role,
    });
    const login = await request(server()).post('/auth/login').send({ email, senha: SENHA });
    return (login.body as AuthResponseDto).user;
  }

  beforeAll(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp();
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminUser = (login.body as AuthResponseDto).user;
    // `plantae:read` concedida ao PERFIL GESTOR (como em producao); OPERADOR segue sem.
    const roles = app.get(RolesService, { strict: false });
    const todas = await app.get(PermissionsService, { strict: false }).findAll();
    await roles.addPermissions(
      await roles.getByName(RoleName.Gestor),
      todas.filter((p) => p.code === String(PermissionCode.PlantaeRead)),
    );
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse(listJson([entryJson(482, { statusCode: 0 })]))),
    );
  });

  it('o modulo registra os dois comandos no motor', () => {
    const catalog = app.get(CommandCatalog, { strict: false });

    expect(catalog.find('contas_pagar')).toBeDefined();
    expect(catalog.find('contas_receber')).toBeDefined();
  });

  it('GESTOR com plantae:read: receitas PENDENTES, so GET, aviso de PRODUCAO, sem dado pessoal', async () => {
    const gestor = await novoUsuario(RoleName.Gestor);

    const r = await executar(gestor, '/contas_receber');

    expect(r.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const url = new URL(urlDe(input));
    expect(init.method).toBe('GET');
    expect(url.hostname).toBe('web.plantae.agr.br');
    expect(url.pathname).toBe('/api/v1/external/financial/entries');
    expect(url.searchParams.get('tipo')).toBe('receita');
    expect(url.searchParams.getAll('status[]')).toEqual(['0']);
    expect(url.searchParams.get('per_page')).toBe('5');

    const linhas = r.reply.split(NL);
    expect(linhas[0]).toBe(PRODUCTION_BANNER);
    expect(linhas[1]).toBe('Contas a receber pendentes (Plantae)');
    expect(r.reply).toMatch(/ref 482/);
    expect(r.reply).toContain('8.337,10');
    expect(r.reply).not.toMatch(/HOMOLOGACAO|dados de teste/i);
    expect(r.reply).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(r.reply).not.toContain('Pessoa Ficticia');
    expect(r.reply).not.toMatch(/DOC-|Titulo ficticio/);
  });

  it('/contas_pagar continua funcionando igual para o mesmo GESTOR (sem regressao)', async () => {
    const gestor = await novoUsuario(RoleName.Gestor);

    const r = await executar(gestor, '/contas_pagar');

    expect(r.success).toBe(true);
    const url = new URL(urlDe(fetchSpy.mock.calls[0]?.[0] ?? ''));
    expect(url.searchParams.get('tipo')).toBe('despesa');
    expect(r.reply.split(NL)[1]).toBe('Contas a pagar pendentes (Plantae)');
    expect(r.reply).not.toContain('Pessoa Ficticia');
  });

  it('OPERADOR sem plantae:read: negado ANTES do handler, o Plantae nao e chamado', async () => {
    const operador = await novoUsuario(RoleName.Operador);

    const r = await executar(operador, '/contas_receber');

    expect(r.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('/ajuda: GESTOR autorizado ve os dois comandos; OPERADOR nao ve nenhum', async () => {
    const gestor = await novoUsuario(RoleName.Gestor);
    const operador = await novoUsuario(RoleName.Operador);

    const ajudaGestor = (await executar(gestor, '/ajuda')).reply;
    const ajudaOperador = (await executar(operador, '/ajuda')).reply;

    expect(ajudaGestor).toContain('/contas_pagar');
    expect(ajudaGestor).toContain('/contas_receber');
    expect(ajudaOperador).not.toContain('/contas_pagar');
    expect(ajudaOperador).not.toContain('/contas_receber');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('o limitador por pessoa e UM SO para os dois comandos (montado pelo modulo)', async () => {
    const gestor = await novoUsuario(RoleName.Gestor);
    const textos = ['/contas_pagar', '/contas_receber', '/contas_pagar'];
    expect(textos).toHaveLength(CHAT_QUERIES_PER_MINUTE);

    for (const texto of textos) {
      expect((await executar(gestor, texto)).success).toBe(true);
    }
    const quarta = await executar(gestor, '/contas_receber');
    const quinta = await executar(gestor, '/contas_pagar');

    expect(quarta.reply).toBe(CONTAS_RECEBER_MESSAGES.throttled);
    expect(quinta.reply).toBe(CONTAS_PAGAR_MESSAGES.throttled);
    expect(fetchSpy).toHaveBeenCalledTimes(CHAT_QUERIES_PER_MINUTE);
  });

  it('argumento invalido: orientacao de uso de /contas_receber, sem consultar', async () => {
    const gestor = await novoUsuario(RoleName.Gestor);

    const r = await executar(gestor, '/contas_receber 2026-13-45 abc');

    expect(r.success).toBe(false);
    expect(r.reply).toContain('/contas_receber AAAA-MM-DD AAAA-MM-DD');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falha do Plantae: frase fixa, sem valores e sem o token', async () => {
    fetchSpy.mockResolvedValue(jsonResponse('{"message":"erro"}', { status: 500 }));

    const r = await executar(adminUser, '/contas_receber');

    expect(r.success).toBe(false);
    expect(r.reply).toBe(CONTAS_RECEBER_MESSAGES.unavailable);
    expect(r.reply).not.toContain('plt_');
  });

  it('auditoria do motor: PLANTAE_QUERIED com o comando e o desfecho, sem conteudo', async () => {
    const gestor = await novoUsuario(RoleName.Gestor);
    await executar(gestor, '/contas_receber');

    const adminJwt = (
      (await request(server()).post('/auth/login').send(ADMIN).expect(200)).body as AuthResponseDto
    ).accessToken;
    const logs = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    const eventos = (logs.body as AuditLogPageResponseDto).items.filter(
      (e) => e.acao === 'PLANTAE_QUERIED' && e.usuarioId === gestor.id,
    );

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.metadados).toMatchObject({
      comando: 'contas_receber',
      canal: 'telegram',
      detalhe: 'ok',
    });
    expect(JSON.stringify(eventos)).not.toMatch(/8337|Pessoa Ficticia|000\.000/);
  });
});
