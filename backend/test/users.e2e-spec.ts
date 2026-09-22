import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ErrorResponseDto } from '../src/common/dto/error-response.dto';
import type { AuditLogResponseDto } from '../src/modules/audit/dto/audit-log-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import type { UserPageResponseDto } from '../src/modules/users/dto/user-page-response.dto';
import type { UserResponseDto } from '../src/modules/users/dto/user-response.dto';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** Nada que lembre credencial pode aparecer numa resposta de usuario. */
const CREDENTIAL_PATTERN = /senha|hash|password|token|secret/i;

interface Session {
  id: string;
  email: string;
  token: string;
}

describe('Administracao de usuarios (e2e)', () => {
  let app: INestApplication;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;
  const uniqueEmail = (prefix = 'user'): string => `${prefix}${++counter}@adm.vasta.test`;

  async function login(email: string, senha: string): Promise<AuthResponseDto> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return response.body as AuthResponseDto;
  }

  /** Cria o usuario direto pelo service (fora das regras HTTP) e devolve a sessao dele. */
  async function sessionFor(role: RoleName): Promise<Session> {
    const email = uniqueEmail(role.toLowerCase());
    const user = await app
      .get(UsersService, { strict: false })
      .create({ nome: `Teste ${role}`, email, senha: VALID_PASSWORD, role });
    return { id: user.id, email, token: (await login(email, VALID_PASSWORD)).accessToken };
  }

  async function createVia(
    actor: Session,
    body: Record<string, unknown>,
    expected = 201,
  ): Promise<UserResponseDto> {
    const response = await request(server())
      .post('/users')
      .set('Authorization', bearer(actor.token))
      .send({ nome: 'Pessoa Criada', email: uniqueEmail(), senha: VALID_PASSWORD, ...body })
      .expect(expected);
    return response.body as UserResponseDto;
  }

  function patch(actor: Session, path: string, body: object): request.Test {
    return request(server()).patch(path).set('Authorization', bearer(actor.token)).send(body);
  }

  async function auditFor(alvoId: string, acao?: string): Promise<AuditLogResponseDto[]> {
    const { accessToken } = await login(ADMIN.email, ADMIN.senha);
    const response = await request(server())
      .get('/audit-logs?limit=200')
      .set('Authorization', bearer(accessToken))
      .expect(200);
    return (response.body as AuditLogResponseDto[]).filter(
      (log) => log.metadados?.alvoId === alvoId && (acao === undefined || log.acao === acao),
    );
  }

  let admin: Session;
  let gestor: Session;
  let operador: Session;
  let usuario: Session;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await sessionFor(RoleName.Admin);
    gestor = await sessionFor(RoleName.Gestor);
    operador = await sessionFor(RoleName.Operador);
    usuario = await sessionFor(RoleName.Usuario);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users', () => {
    it.each([
      ['ADMIN', () => admin, 200],
      ['GESTOR', () => gestor, 200],
      ['OPERADOR', () => operador, 403],
      ['USUARIO', () => usuario, 403],
    ])('perfil %s responde %i', async (_role, actor, status) => {
      await request(server())
        .get('/users')
        .set('Authorization', bearer(actor().token))
        .expect(status);
    });

    it('sem token responde 401', async () => {
      await request(server()).get('/users').expect(401);
    });

    it('pagina os resultados e informa o total', async () => {
      const first = (
        await request(server())
          .get('/users?page=1&limit=2')
          .set('Authorization', bearer(admin.token))
          .expect(200)
      ).body as UserPageResponseDto;
      const second = (
        await request(server())
          .get('/users?page=2&limit=2')
          .set('Authorization', bearer(admin.token))
          .expect(200)
      ).body as UserPageResponseDto;

      expect(first).toMatchObject({ page: 1, limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.total).toBeGreaterThanOrEqual(5);
      expect(second.total).toBe(first.total);
      const ids = [...first.items, ...second.items].map((user) => user.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('usa 20 por pagina por padrao', async () => {
      const body = (
        await request(server()).get('/users').set('Authorization', bearer(admin.token)).expect(200)
      ).body as UserPageResponseDto;

      expect(body).toMatchObject({ page: 1, limit: 20 });
    });

    it.each(['page=0', 'limit=0', 'limit=101', 'page=abc'])(
      'rejeita paginacao invalida (%s) com 400',
      async (query) => {
        await request(server())
          .get(`/users?${query}`)
          .set('Authorization', bearer(admin.token))
          .expect(400);
      },
    );

    it('nunca expoe hash, senha ou token', async () => {
      const response = await request(server())
        .get('/users?limit=100')
        .set('Authorization', bearer(admin.token))
        .expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(CREDENTIAL_PATTERN);
      const [first] = (response.body as UserPageResponseDto).items;
      expect(Object.keys(first).sort()).toEqual(
        ['id', 'nome', 'email', 'role', 'permissions', 'ativo', 'createdAt', 'updatedAt'].sort(),
      );
    });
  });

  describe('GET /users/:id', () => {
    it('devolve o usuario, sem credenciais', async () => {
      const response = await request(server())
        .get(`/users/${operador.id}`)
        .set('Authorization', bearer(gestor.token))
        .expect(200);

      expect(response.body).toMatchObject({ id: operador.id, email: operador.email });
      expect(JSON.stringify(response.body)).not.toMatch(CREDENTIAL_PATTERN);
    });

    it('404 para id inexistente e 400 para id que nao e UUID', async () => {
      await request(server())
        .get(`/users/${UNKNOWN_ID}`)
        .set('Authorization', bearer(admin.token))
        .expect(404);
      await request(server())
        .get('/users/nao-e-uuid')
        .set('Authorization', bearer(admin.token))
        .expect(400);
    });

    it('perfil sem users:read recebe 403', async () => {
      await request(server())
        .get(`/users/${usuario.id}`)
        .set('Authorization', bearer(usuario.token))
        .expect(403);
    });
  });

  describe('GET /users/assignable-roles', () => {
    it('ADMIN concede todos; GESTOR apenas os perfis abaixo do seu', async () => {
      const forAdmin = await request(server())
        .get('/users/assignable-roles')
        .set('Authorization', bearer(admin.token))
        .expect(200);
      const forGestor = await request(server())
        .get('/users/assignable-roles')
        .set('Authorization', bearer(gestor.token))
        .expect(200);

      expect(forAdmin.body).toEqual(Object.values(RoleName));
      expect(forGestor.body).toEqual([RoleName.Operador, RoleName.Usuario]);
    });
  });

  describe('POST /users', () => {
    it('cria usuario ativo, com USUARIO por padrao, que consegue fazer login', async () => {
      const email = uniqueEmail('Nova.Pessoa');
      const created = await createVia(admin, {
        nome: '  Nova Pessoa ',
        email: email.toUpperCase(),
      });

      expect(created).toMatchObject({
        nome: 'Nova Pessoa',
        email: email.toLowerCase(),
        role: RoleName.Usuario,
        ativo: true,
      });
      expect(JSON.stringify(created)).not.toMatch(CREDENTIAL_PATTERN);
      await login(email.toLowerCase(), VALID_PASSWORD);
    });

    it('grava a senha como hash bcrypt', async () => {
      const created = await createVia(admin, {});
      const stored = await app.get(UsersService, { strict: false }).findById(created.id);

      expect(stored?.senhaHash).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(stored?.senhaHash).not.toContain(VALID_PASSWORD);
    });

    it('rejeita e-mail duplicado com 409, ignorando maiusculas', async () => {
      const response = await request(server())
        .post('/users')
        .set('Authorization', bearer(admin.token))
        .send({ nome: 'Duplicado', email: operador.email.toUpperCase(), senha: VALID_PASSWORD })
        .expect(409);

      expect((response.body as ErrorResponseDto).message).toBe('E-mail ja cadastrado');
    });

    it.each([
      ['e-mail invalido', { email: 'nao-e-email' }],
      ['nome vazio', { nome: '   ' }],
      ['sem senha', { senha: undefined }],
      ['senha fraca', { senha: 'fraca' }],
      ['perfil inexistente', { role: 'SUPERUSUARIO' }],
      ['campo nao permitido', { ativo: false }],
    ])('rejeita %s com 400', async (_caso, body) => {
      await createVia(admin, body, 400);
    });

    it('GESTOR cria OPERADOR e USUARIO', async () => {
      await createVia(gestor, { role: RoleName.Operador });
      await createVia(gestor, { role: RoleName.Usuario });
    });

    it.each([RoleName.Gestor, RoleName.Admin])(
      'GESTOR nao cria %s (403) e nada e gravado',
      async (role) => {
        const email = uniqueEmail();
        await createVia(gestor, { role, email }, 403);

        expect(await app.get(UsersService, { strict: false }).findByEmail(email)).toBeNull();
      },
    );

    it('ADMIN cria outro ADMIN', async () => {
      expect(await createVia(admin, { role: RoleName.Admin })).toMatchObject({
        role: RoleName.Admin,
      });
    });

    it('perfil sem users:create recebe 403', async () => {
      await createVia(operador, {}, 403);
    });

    it('audita USER_CREATED com o autor, sem a senha', async () => {
      const created = await createVia(gestor, {});
      const [log] = await auditFor(created.id, 'USER_CREATED');

      expect(log).toMatchObject({
        usuarioId: gestor.id,
        acao: 'USER_CREATED',
        modulo: 'USERS',
        metadados: { alvoId: created.id, email: created.email, role: RoleName.Usuario },
      });
      expect(JSON.stringify(log)).not.toContain(VALID_PASSWORD);
    });
  });

  describe('PATCH /users/:id', () => {
    it('edita nome e e-mail e audita o antes/depois', async () => {
      const target = await createVia(admin, {});
      const email = uniqueEmail('editado');

      const response = await patch(admin, `/users/${target.id}`, {
        nome: 'Nome Editado',
        email,
      }).expect(200);

      expect(response.body).toMatchObject({ nome: 'Nome Editado', email, role: target.role });
      expect(JSON.stringify(response.body)).not.toMatch(CREDENTIAL_PATTERN);
      const [log] = await auditFor(target.id, 'USER_UPDATED');
      expect(log).toMatchObject({
        acao: 'USER_UPDATED',
        metadados: {
          alteracoes: {
            nome: { de: target.nome, para: 'Nome Editado' },
            email: { de: target.email, para: email },
          },
        },
      });
    });

    it.each([
      ['senha', { senha: 'OutraSenha1' }],
      ['perfil', { role: RoleName.Admin }],
      ['status', { ativo: false }],
    ])('nao altera %s por aqui (400)', async (_campo, body) => {
      const target = await createVia(admin, {});

      await patch(admin, `/users/${target.id}`, body).expect(400);
      await login(target.email, VALID_PASSWORD);
    });

    it('e-mail de outro usuario: 409', async () => {
      const target = await createVia(admin, {});

      await patch(admin, `/users/${target.id}`, { email: operador.email }).expect(409);
    });

    it('GESTOR nao edita ADMIN nem outro GESTOR (403)', async () => {
      const otherGestor = await sessionFor(RoleName.Gestor);

      await patch(gestor, `/users/${admin.id}`, { nome: 'Hack' }).expect(403);
      await patch(gestor, `/users/${otherGestor.id}`, { nome: 'Hack' }).expect(403);
    });

    it('o proprio usuario edita os seus dados', async () => {
      const self = await sessionFor(RoleName.Gestor);

      await patch(self, `/users/${self.id}`, { nome: 'Meu Nome Novo' }).expect(200);
    });

    it('perfil sem users:update recebe 403, mesmo sobre si mesmo', async () => {
      await patch(usuario, `/users/${usuario.id}`, { nome: 'X' }).expect(403);
    });

    it('404 para usuario inexistente', async () => {
      await patch(admin, `/users/${UNKNOWN_ID}`, { nome: 'X' }).expect(404);
    });
  });

  describe('PATCH /users/:id/status', () => {
    it('desativar bloqueia o login e derruba o token na hora; reativar devolve o acesso', async () => {
      const target = await sessionFor(RoleName.Usuario);

      const off = await patch(gestor, `/users/${target.id}/status`, { ativo: false }).expect(200);
      expect(off.body).toMatchObject({ ativo: false });
      await request(server())
        .get('/auth/me')
        .set('Authorization', bearer(target.token))
        .expect(401);
      await request(server())
        .post('/auth/login')
        .send({ email: target.email, senha: VALID_PASSWORD })
        .expect(403);

      await patch(gestor, `/users/${target.id}/status`, { ativo: true }).expect(200);
      await login(target.email, VALID_PASSWORD);

      const actions = (await auditFor(target.id)).map((log) => log.acao).sort();
      expect(actions).toEqual(['USER_ACTIVATED', 'USER_DEACTIVATED']);
    });

    it('GESTOR nao desativa ADMIN nem outro GESTOR (403)', async () => {
      const otherGestor = await sessionFor(RoleName.Gestor);

      await patch(gestor, `/users/${admin.id}/status`, { ativo: false }).expect(403);
      await patch(gestor, `/users/${otherGestor.id}/status`, { ativo: false }).expect(403);
      await request(server()).get('/auth/me').set('Authorization', bearer(admin.token)).expect(200);
    });

    it('GESTOR nao reativa um usuario inativo acima do seu alcance (403)', async () => {
      const inactiveGestor = await sessionFor(RoleName.Gestor);
      await patch(admin, `/users/${inactiveGestor.id}/status`, { ativo: false }).expect(200);

      await patch(gestor, `/users/${inactiveGestor.id}/status`, { ativo: true }).expect(403);
    });

    it('ninguem altera o proprio status (403)', async () => {
      await patch(gestor, `/users/${gestor.id}/status`, { ativo: false }).expect(403);
    });

    it('perfil sem users:status recebe 403', async () => {
      await patch(operador, `/users/${usuario.id}/status`, { ativo: false }).expect(403);
    });

    it('rejeita corpo invalido com 400', async () => {
      await patch(admin, `/users/${usuario.id}/status`, { ativo: 'nao' }).expect(400);
    });
  });

  describe('PATCH /users/:id/role', () => {
    it('troca o perfil e as permissoes novas valem na hora, com o token antigo', async () => {
      const target = await sessionFor(RoleName.Usuario);
      await request(server()).get('/users').set('Authorization', bearer(target.token)).expect(403);

      const response = await patch(admin, `/users/${target.id}/role`, {
        role: RoleName.Gestor,
      }).expect(200);

      expect(response.body).toMatchObject({ role: RoleName.Gestor });
      await request(server()).get('/users').set('Authorization', bearer(target.token)).expect(200);
      const [log] = await auditFor(target.id, 'USER_ROLE_CHANGED');
      expect(log).toMatchObject({
        usuarioId: admin.id,
        acao: 'USER_ROLE_CHANGED',
        metadados: { alvoId: target.id, de: RoleName.Usuario, para: RoleName.Gestor },
      });
    });

    it('GESTOR alterna um usuario entre OPERADOR e USUARIO', async () => {
      const target = await createVia(gestor, {});

      await patch(gestor, `/users/${target.id}/role`, { role: RoleName.Operador }).expect(200);
      await patch(gestor, `/users/${target.id}/role`, { role: RoleName.Usuario }).expect(200);
    });

    it.each([RoleName.Gestor, RoleName.Admin])(
      'GESTOR nao promove ninguem a %s (403)',
      async (role) => {
        const target = await createVia(gestor, {});

        await patch(gestor, `/users/${target.id}/role`, { role }).expect(403);
      },
    );

    it('ninguem altera o proprio perfil - nem para se promover (403)', async () => {
      await patch(gestor, `/users/${gestor.id}/role`, { role: RoleName.Admin }).expect(403);
      await request(server())
        .get('/auth/me')
        .set('Authorization', bearer(gestor.token))
        .expect(200)
        .expect((response) => {
          expect((response.body as UserResponseDto).role).toBe(RoleName.Gestor);
        });
    });

    it('GESTOR nao rebaixa um ADMIN (403)', async () => {
      await patch(gestor, `/users/${admin.id}/role`, { role: RoleName.Usuario }).expect(403);
    });

    it('perfil sem users:role recebe 403 e perfil invalido 400', async () => {
      await patch(operador, `/users/${usuario.id}/role`, { role: RoleName.Operador }).expect(403);
      await patch(admin, `/users/${usuario.id}/role`, { role: 'DONO' }).expect(400);
    });
  });

  describe('ultimo ADMIN ativo', () => {
    // Aplicacao propria: aqui o ADMIN do seed precisa ser o UNICO ADMIN.
    let isolated: INestApplication;
    let token: string;
    let adminId: string;

    beforeAll(async () => {
      isolated = await createTestApp();
      const response = await request(isolated.getHttpServer() as Server)
        .post('/auth/login')
        .send(ADMIN)
        .expect(200);
      ({ accessToken: token } = response.body as AuthResponseDto);
      adminId = (response.body as AuthResponseDto).user.id;
    });

    afterAll(async () => {
      await isolated.close();
    });

    const isolatedPatch = (path: string, body: object): request.Test =>
      request(isolated.getHttpServer() as Server)
        .patch(path)
        .set('Authorization', bearer(token))
        .send(body);

    it('nao desativa nem rebaixa o unico ADMIN ativo (409), e ele segue com acesso', async () => {
      const off = await isolatedPatch(`/users/${adminId}/status`, { ativo: false }).expect(409);
      await isolatedPatch(`/users/${adminId}/role`, { role: RoleName.Gestor }).expect(409);

      expect((off.body as ErrorResponseDto).message).toMatch(/ao menos um ADMIN ativo/);
      await request(isolated.getHttpServer() as Server)
        .get('/auth/me')
        .set('Authorization', bearer(token))
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ role: RoleName.Admin, ativo: true });
        });
    });

    it('com um segundo ADMIN ativo, um pode desativar o outro', async () => {
      const created = await request(isolated.getHttpServer() as Server)
        .post('/users')
        .set('Authorization', bearer(token))
        .send({
          nome: 'Segundo Admin',
          email: 'segundo.admin@vasta.test',
          senha: VALID_PASSWORD,
          role: RoleName.Admin,
        })
        .expect(201);
      const second = created.body as UserResponseDto;

      await isolatedPatch(`/users/${second.id}/status`, { ativo: false }).expect(200);
      // Voltou a ser o unico ADMIN ativo.
      await isolatedPatch(`/users/${adminId}/status`, { ativo: false }).expect(409);
    });
  });
});
