import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import type { ErrorResponseDto } from '../src/common/dto/error-response.dto';
import { SeedService } from '../src/database/seed/seed.service';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuditLogResponseDto } from '../src/modules/audit/dto/audit-log-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { RolesService } from '../src/modules/roles/roles.service';
import type { UserResponseDto } from '../src/modules/users/dto/user-response.dto';
import { UsersRepository } from '../src/modules/users/users.repository';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';

describe('Auth, usuarios e RBAC (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;

  /** E-mail unico por chamada, para os testes nao dependerem da ordem de execucao. */
  const uniqueEmail = (prefix = 'user'): string => `${prefix}${++counter}@vasta.test`;

  async function register(
    overrides: Partial<{ nome: string; email: string; senha: string }> = {},
  ): Promise<AuthResponseDto> {
    const response = await request(server())
      .post('/auth/register')
      .send({ nome: 'Maria Silva', email: uniqueEmail(), senha: VALID_PASSWORD, ...overrides })
      .expect(201);
    return response.body as AuthResponseDto;
  }

  async function login(email: string, senha: string): Promise<AuthResponseDto> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return response.body as AuthResponseDto;
  }

  /** Cria um usuario com o perfil pedido (o cadastro publico so cria USUARIO) e devolve o token dele. */
  async function tokenFor(role: RoleName): Promise<string> {
    const email = uniqueEmail(role.toLowerCase());
    await usersService.create({ nome: `Teste ${role}`, email, senha: VALID_PASSWORD, role });
    return (await login(email, VALID_PASSWORD)).accessToken;
  }

  async function deactivate(email: string): Promise<void> {
    const repository = app.get(UsersRepository, { strict: false });
    const user = await repository.findByEmail(email);
    if (!user) {
      throw new Error(`usuario ${email} nao encontrado`);
    }
    user.ativo = false;
    await repository.save(user);
  }

  /** Todos os eventos: o endpoint e paginado (maximo 100 por pagina), entao percorre as paginas. */
  async function auditLogs(): Promise<AuditLogResponseDto[]> {
    const adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
    const all: AuditLogResponseDto[] = [];
    for (let page = 1; ; page += 1) {
      const response = await request(server())
        .get(`/audit-logs?page=${page}&limit=100`)
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const body = response.body as AuditLogPageResponseDto;
      all.push(...body.items);
      if (body.items.length === 0 || all.length >= body.total) {
        return all;
      }
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('cadastra o usuario como USUARIO e devolve token, sem expor a senha', async () => {
      const email = uniqueEmail();
      const body = await register({ nome: '  Maria Silva  ', email });

      expect(body.tokenType).toBe('Bearer');
      expect(body.expiresIn).toBe(3600);
      expect(typeof body.accessToken).toBe('string');
      expect(body.user).toMatchObject({
        nome: 'Maria Silva',
        email,
        role: RoleName.Usuario,
        ativo: true,
        permissions: [],
      });
      expect(JSON.stringify(body)).not.toMatch(/senha|hash|password/i);
    });

    it('persiste apenas o hash bcrypt, nunca a senha em texto puro', async () => {
      const email = uniqueEmail();
      await register({ email });

      const stored = await usersService.findByEmail(email);
      expect(stored?.senhaHash).toBeDefined();
      expect(stored?.senhaHash).not.toBe(VALID_PASSWORD);
      expect(stored?.senhaHash).not.toContain(VALID_PASSWORD);
      expect(stored?.senhaHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('normaliza o e-mail para minusculas', async () => {
      const email = uniqueEmail('Caixa.Alta');
      const body = await register({ email: `  ${email.toUpperCase()}  ` });

      expect(body.user.email).toBe(email.toLowerCase());
    });

    it('rejeita e-mail duplicado com 409, ignorando maiusculas/minusculas', async () => {
      const email = uniqueEmail();
      await register({ email });

      const response = await request(server())
        .post('/auth/register')
        .send({ nome: 'Outra Pessoa', email: email.toUpperCase(), senha: VALID_PASSWORD })
        .expect(409);

      expect((response.body as ErrorResponseDto).message).toBe('E-mail ja cadastrado');
    });

    it('cadastros simultaneos com o mesmo e-mail: um vence e o outro recebe 409 (nunca 500)', async () => {
      const email = uniqueEmail();
      const send = (): request.Test =>
        request(server())
          .post('/auth/register')
          .send({ nome: 'Corrida', email, senha: VALID_PASSWORD });

      const statuses = (await Promise.all([send(), send()])).map((response) => response.status);

      expect(statuses.sort()).toEqual([201, 409]);
    });

    it.each([
      ['curta demais', 'Ab1'],
      ['sem numero', 'SenhaSemNumero'],
      ['sem maiuscula', 'senha1234'],
      ['sem minuscula', 'SENHA1234'],
      ['acima do limite de 72 bytes do bcrypt', `Aa1${'x'.repeat(70)}`],
    ])('rejeita senha %s com 400', async (_descricao, senha) => {
      const response = await request(server())
        .post('/auth/register')
        .send({ nome: 'Maria', email: uniqueEmail(), senha })
        .expect(400);

      expect((response.body as ErrorResponseDto).message).toEqual(
        expect.arrayContaining([expect.stringContaining('senha')]),
      );
    });

    it('rejeita e-mail malformado e nome ausente com 400', async () => {
      await request(server())
        .post('/auth/register')
        .send({ nome: 'Maria', email: 'nao-e-email', senha: VALID_PASSWORD })
        .expect(400);
      await request(server())
        .post('/auth/register')
        .send({ email: uniqueEmail(), senha: VALID_PASSWORD })
        .expect(400);
    });

    it('nao permite escolher o perfil no cadastro (escalada de privilegio)', async () => {
      const email = uniqueEmail();
      await request(server())
        .post('/auth/register')
        .send({ nome: 'Espertinho', email, senha: VALID_PASSWORD, role: 'ADMIN' })
        .expect(400);

      expect(await usersService.findByEmail(email)).toBeNull();
    });
  });

  describe('POST /auth/login', () => {
    it('autentica com credenciais validas e devolve um token que abre rotas protegidas', async () => {
      const email = uniqueEmail();
      await register({ email });

      const body = await login(email, VALID_PASSWORD);
      expect(body.user).toMatchObject({ email, role: RoleName.Usuario });

      const me = await request(server())
        .get('/auth/me')
        .set('Authorization', bearer(body.accessToken))
        .expect(200);
      expect((me.body as UserResponseDto).email).toBe(email);
    });

    it('aceita o e-mail em qualquer combinacao de maiusculas/minusculas', async () => {
      const email = uniqueEmail('login');
      await register({ email });

      await login(email.toUpperCase(), VALID_PASSWORD);
    });

    it('rejeita senha incorreta com 401', async () => {
      const email = uniqueEmail();
      await register({ email });

      const response = await request(server())
        .post('/auth/login')
        .send({ email, senha: 'SenhaErrada1' })
        .expect(401);

      expect((response.body as ErrorResponseDto).message).toBe('Credenciais invalidas');
    });

    it('rejeita usuario inexistente com 401 e a MESMA mensagem da senha incorreta', async () => {
      const email = uniqueEmail();
      await register({ email });

      const wrongPassword = await request(server())
        .post('/auth/login')
        .send({ email, senha: 'SenhaErrada1' })
        .expect(401);
      const unknownUser = await request(server())
        .post('/auth/login')
        .send({ email: 'ninguem@vasta.test', senha: VALID_PASSWORD })
        .expect(401);

      // Mensagens diferentes permitiriam descobrir quais e-mails existem.
      expect((unknownUser.body as ErrorResponseDto).message).toBe(
        (wrongPassword.body as ErrorResponseDto).message,
      );
    });

    it('bloqueia usuario inativo com 403, mesmo com a senha correta', async () => {
      const email = uniqueEmail();
      await register({ email });
      await deactivate(email);

      const response = await request(server())
        .post('/auth/login')
        .send({ email, senha: VALID_PASSWORD })
        .expect(403);

      expect((response.body as ErrorResponseDto).message).toBe('Usuario inativo');
    });

    it('usuario inativo com senha errada recebe 401: o status da conta nao vaza', async () => {
      const email = uniqueEmail();
      await register({ email });
      await deactivate(email);

      await request(server())
        .post('/auth/login')
        .send({ email, senha: 'SenhaErrada1' })
        .expect(401);
    });

    it('rejeita corpo invalido com 400', async () => {
      await request(server()).post('/auth/login').send({ email: 'x' }).expect(400);
      await request(server()).post('/auth/login').send({}).expect(400);
    });
  });

  describe('rotas protegidas e JWT', () => {
    const expectUnauthorized = async (authorization?: string): Promise<void> => {
      const call = request(server()).get('/auth/me');
      const response = await (
        authorization ? call.set('Authorization', authorization) : call
      ).expect(401);
      expect(response.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    };

    it('GET /auth/me sem token responde 401', async () => {
      await expectUnauthorized();
    });

    it('rejeita esquema diferente de Bearer', async () => {
      const { accessToken } = await register();
      await expectUnauthorized(`Basic ${accessToken}`);
    });

    it('rejeita token que nao e um JWT', async () => {
      await expectUnauthorized(bearer('isto-nao-e-um-jwt'));
    });

    it('rejeita JWT assinado com outro segredo', async () => {
      const { user } = await register();
      const forged = new JwtService({ secret: 'outro-segredo-qualquer-com-32-caracteres!' }).sign({
        sub: user.id,
      });
      await expectUnauthorized(bearer(forged));
    });

    it('rejeita JWT adulterado (payload trocado, assinatura original)', async () => {
      const victim = await register();
      const attacker = await register();
      const [header, , signature] = attacker.accessToken.split('.');
      const payload = Buffer.from(JSON.stringify({ sub: victim.user.id })).toString('base64url');

      await expectUnauthorized(bearer(`${header}.${payload}.${signature}`));
    });

    it("rejeita JWT com algoritmo 'none'", async () => {
      const { user } = await register();
      const encode = (value: object): string =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: user.id })}.`;

      await expectUnauthorized(bearer(unsigned));
    });

    it('rejeita JWT expirado', async () => {
      const { user } = await register();
      const jwt = app.get(JwtService, { strict: false });
      const expired = await jwt.signAsync({ sub: user.id }, { expiresIn: -10 });

      await expectUnauthorized(bearer(expired));
    });

    it('rejeita JWT valido cujo usuario nao existe mais', async () => {
      const jwt = app.get(JwtService, { strict: false });
      const orphan = await jwt.signAsync({ sub: '00000000-0000-4000-8000-000000000000' });

      await expectUnauthorized(bearer(orphan));
    });

    it('token emitido antes da desativacao da conta deixa de funcionar na hora', async () => {
      const email = uniqueEmail();
      const { accessToken } = await register({ email });
      await request(server()).get('/auth/me').set('Authorization', bearer(accessToken)).expect(200);

      await deactivate(email);

      await expectUnauthorized(bearer(accessToken));
    });

    it('rotas de negocio tambem exigem autenticacao (guard global, negacao por padrao)', async () => {
      await request(server()).get('/users').expect(401);
      await request(server()).get('/audit-logs').expect(401);
      await request(server()).post('/auth/logout').expect(401);
    });
  });

  describe('RBAC', () => {
    it.each([
      [RoleName.Admin, 200],
      [RoleName.Gestor, 200],
      [RoleName.Operador, 403],
      [RoleName.Usuario, 403],
    ])('GET /users com perfil %s responde %i', async (role, expectedStatus) => {
      const token = await tokenFor(role);

      await request(server())
        .get('/users')
        .set('Authorization', bearer(token))
        .expect(expectedStatus);
    });

    it('GET /users nao expoe hash de senha e inclui o perfil', async () => {
      const token = await tokenFor(RoleName.Admin);

      const response = await request(server())
        .get('/users')
        .set('Authorization', bearer(token))
        .expect(200);
      const users = (response.body as { items: UserResponseDto[] }).items;

      expect(users.length).toBeGreaterThan(0);
      expect(JSON.stringify(users)).not.toMatch(/senha|hash|password/i);
      expect(users[0]).toHaveProperty('role');
    });

    it('GET /audit-logs: ADMIN e GESTOR leem; OPERADOR e USUARIO nao', async () => {
      for (const [role, status] of [
        [RoleName.Admin, 200],
        [RoleName.Gestor, 200],
        [RoleName.Operador, 403],
        [RoleName.Usuario, 403],
      ] as const) {
        const token = await tokenFor(role);
        await request(server())
          .get('/audit-logs')
          .set('Authorization', bearer(token))
          .expect(status);
      }
    });

    it('/auth/me lista as permissoes do perfil', async () => {
      const token = await tokenFor(RoleName.Gestor);

      const response = await request(server())
        .get('/auth/me')
        .set('Authorization', bearer(token))
        .expect(200);

      expect((response.body as UserResponseDto).permissions).toEqual(
        expect.arrayContaining(['users:read', 'audit:read']),
      );
    });
  });

  describe('POST /auth/logout', () => {
    it('responde 204 e exige autenticacao', async () => {
      const { accessToken } = await register();

      await request(server())
        .post('/auth/logout')
        .set('Authorization', bearer(accessToken))
        .expect(204);
      await request(server()).post('/auth/logout').expect(401);
    });
  });

  describe('auditoria', () => {
    it('registra REGISTER, LOGIN e LOGOUT com usuario, modulo, descricao, IP e data', async () => {
      const email = uniqueEmail('auditado');
      const { user } = await register({ email });
      const { accessToken } = await login(email, VALID_PASSWORD);
      await request(server())
        .post('/auth/logout')
        .set('Authorization', bearer(accessToken))
        .expect(204);

      const mine = (await auditLogs()).filter((log) => log.usuarioId === user.id);

      expect(mine.map((log) => log.acao).sort()).toEqual(['LOGIN', 'LOGOUT', 'REGISTER']);
      for (const log of mine) {
        expect(log).toMatchObject({ usuarioId: user.id, modulo: 'AUTH' });
        expect(log.descricao).toContain(email);
        expect(typeof log.ip).toBe('string');
        expect(log.ip).not.toBe('');
        expect(Number.isNaN(Date.parse(String(log.createdAt)))).toBe(false);
      }
    });

    it('registra LOGIN_FAILED para senha errada, e-mail inexistente e usuario inativo', async () => {
      const wrongPasswordEmail = uniqueEmail('errada');
      const inactiveEmail = uniqueEmail('inativo');
      const unknownEmail = uniqueEmail('fantasma');
      const wrongPasswordUser = await register({ email: wrongPasswordEmail });
      const inactiveUser = await register({ email: inactiveEmail });
      await deactivate(inactiveEmail);

      const attempt = (email: string, senha: string, status: number): Promise<unknown> =>
        request(server()).post('/auth/login').send({ email, senha }).expect(status);
      await attempt(wrongPasswordEmail, 'SenhaErrada1', 401);
      await attempt(unknownEmail, VALID_PASSWORD, 401);
      await attempt(inactiveEmail, VALID_PASSWORD, 403);

      const failures = (await auditLogs()).filter((log) => log.acao === 'LOGIN_FAILED');
      const find = (email: string): AuditLogResponseDto | undefined =>
        failures.find((log) => log.descricao.includes(email));

      expect(find(wrongPasswordEmail)?.usuarioId).toBe(wrongPasswordUser.user.id);
      expect(find(inactiveEmail)?.usuarioId).toBe(inactiveUser.user.id);
      // E-mail inexistente: ha registro, mas sem usuario associado.
      expect(find(unknownEmail)).toMatchObject({ usuarioId: null, modulo: 'AUTH' });

      // O motivo vai nos metadados, persistidos e devolvidos como objeto JSON.
      expect(find(wrongPasswordEmail)?.metadados).toEqual({ motivo: 'CREDENCIAIS_INVALIDAS' });
      expect(find(unknownEmail)?.metadados).toEqual({ motivo: 'CREDENCIAIS_INVALIDAS' });
      expect(find(inactiveEmail)?.metadados).toEqual({ motivo: 'USUARIO_INATIVO' });
    });

    it('eventos sem detalhes adicionais tem metadados null', async () => {
      const email = uniqueEmail('semmeta');
      const { user } = await register({ email });

      const registro = (await auditLogs()).find(
        (log) => log.usuarioId === user.id && log.acao === 'REGISTER',
      );

      expect(registro).toBeDefined();
      expect(registro?.metadados).toBeNull();
    });

    it('nunca grava senha na trilha de auditoria', async () => {
      const senha = 'SenhaSecreta99';
      const email = uniqueEmail();
      await register({ email, senha });
      await request(server())
        .post('/auth/login')
        .send({ email, senha: `${senha}x` })
        .expect(401);

      expect(JSON.stringify(await auditLogs())).not.toContain(senha);
    });
  });

  describe('documentacao', () => {
    it('gera o documento OpenAPI com todas as rotas de auth, usuarios e auditoria', () => {
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());

      expect(Object.keys(document.paths).sort()).toEqual(
        [
          '/audit-logs',
          '/auth/login',
          '/auth/logout',
          '/auth/me',
          '/auth/register',
          '/commands/execute',
          '/dashboard/summary',
          '/documents',
          '/documents/{id}/download',
          '/finance/entries',
          '/finance/entries/{id}',
          '/finance/entries/{id}/status',
          '/finance/reports/export',
          '/finance/reports/summary',
          '/health',
          '/health/readiness',
          '/notifications',
          '/notifications/read-all',
          '/notifications/unread-count',
          '/notifications/{id}',
          '/notifications/{id}/read',
          '/profile',
          '/settings',
          '/settings/{key}',
          '/users',
          '/users/assignable-roles',
          '/users/{id}',
          '/users/{id}/external-identities',
          '/users/{id}/external-identities/link-requests',
          '/users/{id}/external-identities/link-requests/{requestId}',
          '/users/{id}/external-identities/{linkId}',
          '/users/{id}/role',
          '/users/{id}/status',
        ].sort(),
      );
    });
  });

  describe('seed', () => {
    it('cria o administrador inicial, que consegue autenticar', async () => {
      const body = await login(ADMIN.email, ADMIN.senha);

      expect(body.user).toMatchObject({ email: ADMIN.email, role: RoleName.Admin });
    });

    it('cria os quatro perfis com as permissoes padrao', async () => {
      const roles = await app.get(RolesService, { strict: false }).findAll();
      const permissionsOf = (nome: RoleName): string[] =>
        roles
          .find((role) => role.nome === nome)
          ?.permissions.map((p) => p.code)
          .sort() ?? [];

      expect(roles.map((role) => role.nome).sort()).toEqual(
        [RoleName.Admin, RoleName.Gestor, RoleName.Operador, RoleName.Usuario].sort(),
      );
      // GESTOR administra usuarios, auditoria, financeiro e documentos; as
      // configuracoes do sistema sao exclusivas do ADMIN nesta etapa. Fora
      // isso, a diferenca entre os dois esta na hierarquia
      // (`user-access.policy.ts`).
      const doGestor = [
        'audit:read',
        'documents:create',
        'documents:read',
        'finance:create',
        'finance:read',
        'finance:status',
        'finance:update',
        'users:create',
        'users:read',
        'users:role',
        'users:status',
        'users:update',
      ];
      expect(permissionsOf(RoleName.Admin)).toEqual(
        [...doGestor, 'settings:read', 'settings:update'].sort(),
      );
      expect(permissionsOf(RoleName.Gestor)).toEqual(doGestor);
      expect(permissionsOf(RoleName.Gestor)).not.toContain('settings:read');
      expect(permissionsOf(RoleName.Gestor)).not.toContain('settings:update');
      expect(permissionsOf(RoleName.Operador)).toEqual([]);
      expect(permissionsOf(RoleName.Usuario)).toEqual([]);
    });

    it('e idempotente: rodar de novo nao duplica perfis nem usuarios', async () => {
      const rolesService = app.get(RolesService, { strict: false });
      const before = (await rolesService.findAll()).length;

      await app.get(SeedService, { strict: false }).onApplicationBootstrap();

      expect((await rolesService.findAll()).length).toBe(before);
      expect((await usersService.findAll(500)).filter((u) => u.email === ADMIN.email)).toHaveLength(
        1,
      );
    });
  });
});
