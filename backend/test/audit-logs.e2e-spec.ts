import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';

/**
 * Paginacao de `GET /audit-logs`, usada pela tela completa de auditoria.
 *
 * O acesso (401/403) ja e coberto em auth.e2e-spec.ts; aqui o foco e o
 * contrato da pagina.
 */
describe('GET /audit-logs paginado (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let adminToken: string;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;
  const uniqueEmail = (prefix = 'user'): string => `${prefix}${++counter}@vasta.test`;

  async function login(email: string, senha: string): Promise<AuthResponseDto> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return response.body as AuthResponseDto;
  }

  async function fetchPage(query = ''): Promise<AuditLogPageResponseDto> {
    const response = await request(server())
      .get(`/audit-logs${query}`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    return response.body as AuditLogPageResponseDto;
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });

    // Alguns eventos reais para paginar: cada login gera um registro.
    for (let i = 0; i < 6; i += 1) {
      const email = uniqueEmail('audit');
      await usersService.create({
        nome: `Pessoa ${i}`,
        email,
        senha: VALID_PASSWORD,
        role: RoleName.Usuario,
      });
      await login(email, VALID_PASSWORD);
    }
    adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('devolve items, total, page e limit', async () => {
    const body = await fetchPage();

    expect(Object.keys(body).sort()).toEqual(['items', 'limit', 'page', 'total']);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('respeita page e limit, sem repetir evento entre paginas', async () => {
    const primeira = await fetchPage('?page=1&limit=3');
    const segunda = await fetchPage('?page=2&limit=3');

    expect(primeira.items).toHaveLength(3);
    expect(segunda.items).toHaveLength(3);
    expect(primeira.page).toBe(1);
    expect(segunda.page).toBe(2);
    expect(primeira.total).toBe(segunda.total);

    const ids = [...primeira.items, ...segunda.items].map((log) => log.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('ordena do mais recente para o mais antigo', async () => {
    const { items } = await fetchPage('?limit=10');
    const datas = items.map((log) => Date.parse(String(log.createdAt)));

    expect([...datas].sort((a, b) => b - a)).toEqual(datas);
  });

  it('a ordem e estavel: percorrer todas as paginas devolve cada evento uma unica vez', async () => {
    const { total } = await fetchPage('?limit=1');
    const vistos: string[] = [];

    for (let page = 1; vistos.length < total; page += 1) {
      const { items } = await fetchPage(`?page=${page}&limit=2`);
      if (items.length === 0) {
        break;
      }
      vistos.push(...items.map((log) => log.id));
    }

    expect(vistos).toHaveLength(total);
    expect(new Set(vistos).size).toBe(total);
  });

  it('pagina alem do fim devolve lista vazia, mas mantem o total', async () => {
    const { total } = await fetchPage();
    const body = await fetchPage(`?page=${total + 10}&limit=20`);

    expect(body.items).toEqual([]);
    expect(body.total).toBe(total);
  });

  it('rejeita paginacao invalida com 400', async () => {
    for (const query of ['?page=0', '?page=-1', '?limit=0', '?limit=101', '?page=abc']) {
      await request(server())
        .get(`/audit-logs${query}`)
        .set('Authorization', bearer(adminToken))
        .expect(400);
    }
  });

  describe('responsavel', () => {
    it('identifica quem executou a acao, com nome e e-mail', async () => {
      const email = uniqueEmail('responsavel');
      const criado = await usersService.create({
        nome: 'Pessoa Responsavel',
        email,
        senha: VALID_PASSWORD,
        role: RoleName.Usuario,
      });
      await login(email, VALID_PASSWORD);

      const { items } = await fetchPage('?limit=100');
      const meuLogin = items.find((log) => log.acao === 'LOGIN' && log.usuarioId === criado.id);

      expect(meuLogin?.usuario).toEqual({
        id: criado.id,
        nome: 'Pessoa Responsavel',
        email,
      });
    });

    it('evento sem usuario identificado vem com usuario nulo', async () => {
      await request(server())
        .post('/auth/login')
        .send({ email: uniqueEmail('fantasma'), senha: VALID_PASSWORD })
        .expect(401);

      const { items } = await fetchPage('?limit=100');
      const recusado = items.find((log) => log.acao === 'LOGIN_FAILED' && log.usuarioId === null);

      expect(recusado).toBeDefined();
      expect(recusado?.usuario).toBeNull();
    });

    it('todo evento com usuarioId tem o responsavel identificado', async () => {
      const { items } = await fetchPage('?limit=100');
      const comUsuario = items.filter((log) => log.usuarioId !== null);

      expect(comUsuario.length).toBeGreaterThan(0);
      expect(comUsuario.filter((log) => log.usuario === null)).toEqual([]);
      for (const log of comUsuario) {
        expect(log.usuario?.id).toBe(log.usuarioId);
        expect(log.usuario?.nome).not.toBe('');
        expect(log.usuario?.email).toContain('@');
      }
    });

    it('o responsavel traz apenas id, nome e e-mail - nada de hash ou perfil', async () => {
      const { items } = await fetchPage('?limit=100');
      const comUsuario = items.find((log) => log.usuario !== null);

      expect(Object.keys(comUsuario?.usuario ?? {}).sort()).toEqual(['email', 'id', 'nome']);
    });
  });

  it('nao expoe hash de senha nem token na resposta', async () => {
    const texto = JSON.stringify(await fetchPage('?limit=100'));

    expect(texto).not.toMatch(/senhaHash|senha_hash|password/i);
    expect(texto).not.toMatch(/\$2[aby]\$/);
    expect(texto).not.toContain(adminToken);
    expect(texto).not.toContain(VALID_PASSWORD);
  });
});
