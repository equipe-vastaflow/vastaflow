import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { DashboardSummaryResponseDto } from '../src/modules/dashboard/dto/dashboard-summary-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersRepository } from '../src/modules/users/users.repository';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let usersRepository: UsersRepository;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;
  const uniqueEmail = (prefix = 'user'): string => `${prefix}${++counter}@vasta.test`;

  async function login(email: string, senha: string): Promise<AuthResponseDto> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return response.body as AuthResponseDto;
  }

  /** Cria um usuario com o perfil pedido e devolve o token dele. */
  async function tokenFor(role: RoleName): Promise<string> {
    const email = uniqueEmail(role.toLowerCase());
    await usersService.create({ nome: `Teste ${role}`, email, senha: VALID_PASSWORD, role });
    return (await login(email, VALID_PASSWORD)).accessToken;
  }

  async function summary(token: string): Promise<DashboardSummaryResponseDto> {
    const response = await request(server())
      .get('/dashboard/summary')
      .set('Authorization', bearer(token))
      .expect(200);
    return response.body as DashboardSummaryResponseDto;
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    usersRepository = app.get(UsersRepository, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('acesso', () => {
    it('sem token responde 401', async () => {
      await request(server()).get('/dashboard/summary').expect(401);
    });

    it('token invalido responde 401', async () => {
      await request(server())
        .get('/dashboard/summary')
        .set('Authorization', bearer('nao-e-um-jwt'))
        .expect(401);
    });

    it('usuario autenticado consulta o dashboard', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;

      await request(server())
        .get('/dashboard/summary')
        .set('Authorization', bearer(token))
        .expect(200);
    });

    it('token de usuario desativado deixa de valer imediatamente', async () => {
      const email = uniqueEmail('desativado');
      await usersService.create({
        nome: 'Sera Desativado',
        email,
        senha: VALID_PASSWORD,
        role: RoleName.Gestor,
      });
      const token = (await login(email, VALID_PASSWORD)).accessToken;
      await summary(token);

      const user = await usersRepository.findByEmail(email);
      if (!user) {
        throw new Error('usuario nao encontrado');
      }
      user.ativo = false;
      await usersRepository.save(user);

      await request(server())
        .get('/dashboard/summary')
        .set('Authorization', bearer(token))
        .expect(401);
    });
  });

  describe('secoes por permissao', () => {
    it('ADMIN recebe usuarios e auditoria', async () => {
      const body = await summary((await login(ADMIN.email, ADMIN.senha)).accessToken);

      expect(body.usuarios).toBeDefined();
      expect(body.auditoria).toBeDefined();
    });

    it('GESTOR (users:read + audit:read) recebe as duas secoes', async () => {
      const body = await summary(await tokenFor(RoleName.Gestor));

      expect(body.usuarios).toBeDefined();
      expect(body.auditoria).toBeDefined();
    });

    it('USUARIO, sem permissoes, recebe 200 com resumo vazio', async () => {
      const body = await summary(await tokenFor(RoleName.Usuario));

      expect(body).toEqual({});
    });

    it('OPERADOR, sem permissoes, tambem recebe resumo vazio', async () => {
      const body = await summary(await tokenFor(RoleName.Operador));

      expect(body).toEqual({});
    });

    it('sem audit:read o dashboard nao traz auditoria - e /audit-logs continua 403', async () => {
      const token = await tokenFor(RoleName.Usuario);

      expect(await summary(token)).not.toHaveProperty('auditoria');
      await request(server()).get('/audit-logs').set('Authorization', bearer(token)).expect(403);
    });
  });

  describe('contagem de usuarios', () => {
    it('confere com a lista de usuarios e soma ativos + inativos', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;
      const todos = await usersService.findAll(1000);

      const { usuarios } = await summary(token);

      expect(usuarios).toEqual({
        total: todos.length,
        ativos: todos.filter((user) => user.ativo).length,
        inativos: todos.filter((user) => !user.ativo).length,
      });
      expect(usuarios?.ativos ?? 0).toBeGreaterThan(0);
    });

    it('acompanha a criacao e a desativacao de usuarios', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;
      const antes = (await summary(token)).usuarios;

      const email = uniqueEmail('contagem');
      await usersService.create({
        nome: 'Novo Usuario',
        email,
        senha: VALID_PASSWORD,
        role: RoleName.Usuario,
      });

      const depoisDeCriar = (await summary(token)).usuarios;
      expect(depoisDeCriar?.total).toBe((antes?.total ?? 0) + 1);
      expect(depoisDeCriar?.ativos).toBe((antes?.ativos ?? 0) + 1);
      expect(depoisDeCriar?.inativos).toBe(antes?.inativos ?? 0);

      const user = await usersRepository.findByEmail(email);
      if (!user) {
        throw new Error('usuario nao encontrado');
      }
      user.ativo = false;
      await usersRepository.save(user);

      const depoisDeDesativar = (await summary(token)).usuarios;
      expect(depoisDeDesativar?.total).toBe(depoisDeCriar?.total);
      expect(depoisDeDesativar?.ativos).toBe((depoisDeCriar?.ativos ?? 0) - 1);
      expect(depoisDeDesativar?.inativos).toBe((depoisDeCriar?.inativos ?? 0) + 1);
    });
  });

  describe('auditoria recente', () => {
    it('devolve os eventos mais recentes primeiro, com o nome do responsavel', async () => {
      const email = uniqueEmail('auditado');
      const created = await usersService.create({
        nome: 'Pessoa Auditada',
        email,
        senha: VALID_PASSWORD,
        role: RoleName.Usuario,
      });
      await login(email, VALID_PASSWORD);

      const { auditoria } = await summary((await login(ADMIN.email, ADMIN.senha)).accessToken);

      expect(auditoria?.total).toBeGreaterThan(0);
      expect(auditoria?.recentes.length).toBeGreaterThan(0);
      expect(auditoria?.recentes.length).toBeLessThanOrEqual(10);

      const datas = (auditoria?.recentes ?? []).map((evento) =>
        Date.parse(String(evento.createdAt)),
      );
      expect([...datas].sort((a, b) => b - a)).toEqual(datas);

      const meuLogin = auditoria?.recentes.find(
        (evento) => evento.acao === 'LOGIN' && evento.usuario?.id === created.id,
      );
      expect(meuLogin?.usuario?.nome).toBe('Pessoa Auditada');
      expect(meuLogin?.modulo).toBe('AUTH');
    });

    it('evento sem usuario identificado vem com usuario nulo', async () => {
      await request(server())
        .post('/auth/login')
        .send({ email: uniqueEmail('fantasma'), senha: VALID_PASSWORD })
        .expect(401);

      const { auditoria } = await summary((await login(ADMIN.email, ADMIN.senha)).accessToken);
      const semUsuario = auditoria?.recentes.find((evento) => evento.acao === 'LOGIN_FAILED');

      expect(semUsuario).toBeDefined();
      expect(semUsuario?.usuario).toBeNull();
    });
  });

  describe('dados sensiveis', () => {
    it('a resposta nao contem hash de senha, token, segredo nem IP', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;
      const body = await summary(token);
      const texto = JSON.stringify(body);

      expect(texto).not.toMatch(/senhaHash|senha_hash|password|passwordHash/i);
      expect(texto).not.toMatch(/\$2[aby]\$/); // prefixo de hash bcrypt
      expect(texto).not.toMatch(/accessToken|secret|segredo|authorization/i);
      expect(texto).not.toContain(token);
      // `ip` e `metadados` existem no AuditLog, mas nao no resumo do dashboard.
      expect(texto).not.toMatch(/"ip"|"metadados"/);
      expect(texto).not.toContain(ADMIN.senha);
    });

    it('o evento de auditoria traz apenas os campos que o dashboard usa', async () => {
      const { auditoria } = await summary((await login(ADMIN.email, ADMIN.senha)).accessToken);
      const evento = auditoria?.recentes[0];

      expect(evento).toBeDefined();
      expect(Object.keys(evento ?? {}).sort()).toEqual([
        'acao',
        'createdAt',
        'descricao',
        'id',
        'modulo',
        'usuario',
      ]);
    });
  });

  describe('auditoria', () => {
    it('abrir o dashboard nao gera registro de auditoria', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;
      const antes = (await summary(token)).auditoria?.total ?? 0;

      await summary(token);
      await summary(token);

      expect((await summary(token)).auditoria?.total).toBe(antes);
    });
  });
});
