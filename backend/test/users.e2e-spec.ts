import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { ErrorResponseDto } from '../src/common/dto/error-response.dto';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuditLogResponseDto } from '../src/modules/audit/dto/audit-log-response.dto';
import { AuditRepository } from '../src/modules/audit/audit.repository';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { Role } from '../src/modules/roles/entities/role.entity';
import { RoleName } from '../src/modules/roles/role-name.enum';
import type { UserPageResponseDto } from '../src/modules/users/dto/user-page-response.dto';
import type { UserResponseDto } from '../src/modules/users/dto/user-response.dto';
import { UsersRepository } from '../src/modules/users/users.repository';
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

  /** O endpoint e paginado (maximo 100 por pagina): percorre as paginas antes de filtrar. */
  async function auditFor(alvoId: string, acao?: string): Promise<AuditLogResponseDto[]> {
    const { accessToken } = await login(ADMIN.email, ADMIN.senha);
    const all: AuditLogResponseDto[] = [];
    for (let page = 1; ; page += 1) {
      const response = await request(server())
        .get(`/audit-logs?page=${page}&limit=100`)
        .set('Authorization', bearer(accessToken))
        .expect(200);
      const body = response.body as AuditLogPageResponseDto;
      all.push(...body.items);
      if (body.items.length === 0 || all.length >= body.total) {
        break;
      }
    }
    return all.filter(
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

  describe('auditoria best-effort', () => {
    it('falha ao gravar o AuditLog nao desfaz nem recusa a operacao administrativa', async () => {
      const target = await sessionFor(RoleName.Usuario);
      const auditRepository = app.get(AuditRepository, { strict: false });
      const failing = jest
        .spyOn(auditRepository, 'create')
        .mockRejectedValueOnce(new Error('banco de auditoria indisponivel'));

      try {
        const response = await patch(admin, `/users/${target.id}/status`, { ativo: false }).expect(
          200,
        );
        expect(response.body).toMatchObject({ ativo: false });
        expect(failing).toHaveBeenCalledTimes(1);
      } finally {
        failing.mockRestore();
      }

      // A alteracao permaneceu, e a trilha ficou sem o registro dela.
      const stored = await app.get(UsersService, { strict: false }).findById(target.id);
      expect(stored?.ativo).toBe(false);
      expect(await auditFor(target.id, 'USER_DEACTIVATED')).toHaveLength(0);
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

  /**
   * C1/C2: a edicao geral (`PATCH /users/:id`) grava por UPDATE DIRECIONADO.
   *
   * Todos os testes daqui conferem a LINHA NO BANCO, nao a resposta HTTP: a
   * propriedade em jogo e o que ficou persistido. Com o antigo `save(entity)`,
   * uma entidade lida antes de uma alteracao administrativa concorrente
   * reescrevia `ativo`, `role_id` e `senha_hash` com os valores antigos.
   *
   * O instante da alteracao concorrente e simulado: ela e aplicada no banco no
   * momento exato em que a gravacao do PATCH vai acontecer - o instante que o
   * `save` nao sobrevivia.
   */
  describe('PATCH /users/:id: gravacao direcionada', () => {
    let dataSource: DataSource;
    let usersRepository: UsersRepository;

    beforeAll(() => {
      dataSource = app.get(DataSource, { strict: false });
      usersRepository = app.get(UsersRepository, { strict: false });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    interface LinhaCrua {
      nome: string;
      email: string;
      senha_hash: string;
      ativo: boolean;
      role_id: string;
    }

    /** A linha do usuario como esta no banco, sem passar pela API. */
    async function linha(id: string): Promise<LinhaCrua> {
      const [row] = await dataSource.query<
        { nome: string; email: string; senha_hash: string; ativo: number; role_id: string }[]
      >('SELECT nome, email, senha_hash, ativo, role_id FROM users WHERE id = ?', [id]);
      return { ...row, ativo: Boolean(row.ativo) };
    }

    async function roleIdDe(nome: RoleName): Promise<string> {
      const role = await dataSource.getRepository(Role).findOneByOrFail({ nome });
      return role.id;
    }

    /** Cria um alvo que o GESTOR pode gerenciar. */
    async function alvo(): Promise<Session> {
      return sessionFor(RoleName.Usuario);
    }

    /**
     * Aplica a alteracao administrativa EXATAMENTE entre a leitura do alvo e a
     * gravacao do PATCH, e devolve o que o admin gravou.
     */
    function adminAlteraDuranteAGravacao(id: string, sql: string, params: unknown[]): void {
      const real = usersRepository.updateFields.bind(usersRepository);
      jest
        .spyOn(usersRepository, 'updateFields')
        .mockImplementation(async (alvoId, campos, quando) => {
          await dataSource.query(sql, [...params, id]);
          return real(alvoId, campos, quando);
        });
    }

    describe('alteracao simples', () => {
      it('altera so o nome, sem tocar em e-mail, status, perfil nem hash', async () => {
        const target = await alvo();
        const antes = await linha(target.id);

        await patch(admin, `/users/${target.id}`, { nome: 'Nome Novo' }).expect(200);

        expect(await linha(target.id)).toEqual({ ...antes, nome: 'Nome Novo' });
      });

      it('altera so o e-mail, sem tocar em nome, status, perfil nem hash', async () => {
        const target = await alvo();
        const antes = await linha(target.id);
        const novo = uniqueEmail('trocado');

        await patch(admin, `/users/${target.id}`, { email: novo }).expect(200);

        expect(await linha(target.id)).toEqual({ ...antes, email: novo });
      });

      it('altera nome e e-mail juntos, e nada mais', async () => {
        const target = await alvo();
        const antes = await linha(target.id);
        const novo = uniqueEmail('ambos');

        await patch(admin, `/users/${target.id}`, { nome: 'Os Dois', email: novo }).expect(200);

        expect(await linha(target.id)).toEqual({ ...antes, nome: 'Os Dois', email: novo });
      });

      it('e-mail duplicado continua 409 e nao altera nada', async () => {
        const target = await alvo();
        const antes = await linha(target.id);

        await patch(admin, `/users/${target.id}`, { email: gestor.email }).expect(409);

        expect(await linha(target.id)).toEqual(antes);
      });
    });

    describe('concorrencia com operacoes administrativas', () => {
      it('A) nao reativa uma conta que o ADMIN acabou de desativar', async () => {
        const target = await alvo();
        adminAlteraDuranteAGravacao(target.id, 'UPDATE users SET ativo = 0 WHERE id = ?', []);

        await patch(admin, `/users/${target.id}`, { nome: 'Insistindo' }).expect(200);

        const depois = await linha(target.id);
        expect(depois.nome).toBe('Insistindo');
        expect(depois.ativo).toBe(false);
      });

      it('B) nao restaura o perfil que o ADMIN acabou de trocar', async () => {
        const target = await alvo();
        const operadorRole = await roleIdDe(RoleName.Operador);
        adminAlteraDuranteAGravacao(target.id, 'UPDATE users SET role_id = ? WHERE id = ?', [
          operadorRole,
        ]);

        await patch(admin, `/users/${target.id}`, { nome: 'Insistindo' }).expect(200);

        const depois = await linha(target.id);
        expect(depois.nome).toBe('Insistindo');
        expect(depois.role_id).toBe(operadorRole);
      });

      it('C) alterar o e-mail nao reescreve status nem perfil', async () => {
        const target = await alvo();
        const operadorRole = await roleIdDe(RoleName.Operador);
        adminAlteraDuranteAGravacao(
          target.id,
          'UPDATE users SET ativo = 0, role_id = ? WHERE id = ?',
          [operadorRole],
        );
        const novo = uniqueEmail('concorrente');

        await patch(admin, `/users/${target.id}`, { email: novo }).expect(200);

        const depois = await linha(target.id);
        expect(depois.email).toBe(novo);
        expect(depois.ativo).toBe(false);
        expect(depois.role_id).toBe(operadorRole);
      });

      it('D) alterar nome/e-mail nao reescreve senha_hash', async () => {
        const target = await alvo();
        adminAlteraDuranteAGravacao(
          target.id,
          "UPDATE users SET senha_hash = '$2b$04$hashTrocadoPorFora' WHERE id = ?",
          [],
        );

        await patch(admin, `/users/${target.id}`, {
          nome: 'Nome',
          email: uniqueEmail('senha'),
        }).expect(200);

        expect((await linha(target.id)).senha_hash).toBe('$2b$04$hashTrocadoPorFora');
      });
    });

    /**
     * I1: como cada operacao cita apenas as colunas que declarou, uma alteracao
     * de nome nao reescreve o e-mail e vice-versa. Nao ha mecanismo de conflito
     * novo: duas alteracoes do MESMO campo continuam em last-write-wins, que e
     * o que o banco produz.
     */
    describe('duas edicoes gerais simultaneas', () => {
      it('A) nome e e-mail ao mesmo tempo: as duas alteracoes sobrevivem', async () => {
        const target = await alvo();
        const novo = uniqueEmail('cruzado');
        adminAlteraDuranteAGravacao(target.id, 'UPDATE users SET email = ? WHERE id = ?', [novo]);

        await patch(admin, `/users/${target.id}`, { nome: 'So O Nome' }).expect(200);

        const depois = await linha(target.id);
        expect(depois.nome).toBe('So O Nome');
        expect(depois.email).toBe(novo);
      });

      it('B) duas alteracoes de nome: vence a ultima gravacao', async () => {
        const target = await alvo();
        adminAlteraDuranteAGravacao(target.id, 'UPDATE users SET nome = ? WHERE id = ?', [
          'Gravado Primeiro',
        ]);

        await patch(admin, `/users/${target.id}`, { nome: 'Gravado Depois' }).expect(200);

        expect((await linha(target.id)).nome).toBe('Gravado Depois');
      });

      it('C) duas alteracoes de e-mail: vence a ultima gravacao', async () => {
        const target = await alvo();
        const primeiro = uniqueEmail('primeiro');
        const depoisEmail = uniqueEmail('depois');
        adminAlteraDuranteAGravacao(target.id, 'UPDATE users SET email = ? WHERE id = ?', [
          primeiro,
        ]);

        await patch(admin, `/users/${target.id}`, { email: depoisEmail }).expect(200);

        expect((await linha(target.id)).email).toBe(depoisEmail);
      });
    });

    describe('auditoria', () => {
      /** Os campos auditados sao exatamente os que o UPDATE citou. */
      async function camposAuditados(id: string): Promise<string[]> {
        const eventos = await auditFor(id, 'USER_UPDATED');
        expect(eventos).toHaveLength(1);
        const { alteracoes } = eventos[0].metadados as {
          alteracoes: Record<string, unknown>;
        };
        return Object.keys(alteracoes).sort();
      }

      it('alterar so o nome audita so o nome', async () => {
        const target = await alvo();

        await patch(admin, `/users/${target.id}`, { nome: 'Auditado' }).expect(200);

        expect(await camposAuditados(target.id)).toEqual(['nome']);
      });

      it('alterar so o e-mail audita so o e-mail', async () => {
        const target = await alvo();

        await patch(admin, `/users/${target.id}`, { email: uniqueEmail('audit') }).expect(200);

        expect(await camposAuditados(target.id)).toEqual(['email']);
      });

      it('alterar os dois audita os dois', async () => {
        const target = await alvo();

        await patch(admin, `/users/${target.id}`, {
          nome: 'Auditado',
          email: uniqueEmail('audit'),
        }).expect(200);

        expect(await camposAuditados(target.id)).toEqual(['email', 'nome']);
      });

      it('a trilha nao menciona ativo, role nem senha', async () => {
        const target = await alvo();

        await patch(admin, `/users/${target.id}`, {
          nome: 'Sem Vazamento',
          email: uniqueEmail('vaz'),
        }).expect(200);

        const [evento] = await auditFor(target.id, 'USER_UPDATED');
        const registro = JSON.stringify(evento.metadados);
        for (const proibido of ['ativo', 'role', 'senha']) {
          expect(registro).not.toContain(proibido);
        }
      });

      it('operacao sem efeito: nenhuma auditoria e nenhuma alteracao', async () => {
        const target = await alvo();
        const antes = await linha(target.id);

        await patch(admin, `/users/${target.id}`, {
          nome: antes.nome,
          email: antes.email,
        }).expect(200);

        expect(await linha(target.id)).toEqual(antes);
        expect(await auditFor(target.id, 'USER_UPDATED')).toHaveLength(0);
      });

      it('operacao recusada: nenhuma auditoria e nenhuma alteracao', async () => {
        const target = await sessionFor(RoleName.Gestor);
        const antes = await linha(target.id);

        // GESTOR nao gerencia outro GESTOR.
        await patch(gestor, `/users/${target.id}`, { nome: 'Nao Deveria' }).expect(403);
        // Campo fora do DTO.
        await patch(admin, `/users/${target.id}`, { ativo: false }).expect(400);

        expect(await linha(target.id)).toEqual(antes);
        expect(await auditFor(target.id, 'USER_UPDATED')).toHaveLength(0);
      });
    });
  });
});
