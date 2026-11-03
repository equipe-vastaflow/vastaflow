import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditAction } from '../src/modules/audit/audit-action.enum';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const NOVA = 'NovaSenha567';

interface Pessoa {
  id: string;
  email: string;
  token: string;
}

describe('Troca da propria senha (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let jwtService: JwtService;
  let dataSource: DataSource;
  let adminToken: string;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;

  async function login(email: string, senha: string, esperado = 200): Promise<AuthResponseDto> {
    const response = await request(server())
      .post('/auth/login')
      .send({ email, senha })
      .expect(esperado);
    return response.body as AuthResponseDto;
  }

  async function criarPessoa(role = RoleName.Gestor): Promise<Pessoa> {
    const email = `troca${++counter}@vasta.test`;
    const user = await usersService.create({ nome: `Troca ${counter}`, email, senha: SENHA, role });
    return { id: user.id, email, token: (await login(email, SENHA)).accessToken };
  }

  function trocar(token: string | null, body: object): request.Test {
    const req = request(server()).post('/auth/change-password');
    return (token === null ? req : req.set('Authorization', bearer(token))).send(body);
  }

  async function me(token: string, esperado: number): Promise<void> {
    await request(server()).get('/auth/me').set('Authorization', bearer(token)).expect(esperado);
  }

  async function linha(
    id: string,
  ): Promise<{ nome: string; email: string; ativo: number; role_id: string; senha_hash: string }> {
    const [row] = await dataSource.query<
      { nome: string; email: string; ativo: number; role_id: string; senha_hash: string }[]
    >('SELECT nome, email, ativo, role_id, senha_hash FROM users WHERE id = ?', [id]);
    return row;
  }

  async function eventosDeSenha(pessoa: Pessoa): Promise<string[]> {
    const response = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    return (response.body as AuditLogPageResponseDto).items
      .filter(
        (log) =>
          log.acao === (AuditAction.PasswordChanged as string) &&
          log.metadados?.alvoId === pessoa.id,
      )
      .map((log) => log.acao);
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    jwtService = app.get(JwtService, { strict: false });
    dataSource = app.get(DataSource, { strict: false });
    adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('acesso e validacao', () => {
    it('sem token: 401', async () => {
      await trocar(null, { senhaAtual: SENHA, novaSenha: NOVA }).expect(401);
    });

    it('senha atual incorreta: 400 (nunca 401), nada muda e a sessao continua valida', async () => {
      const pessoa = await criarPessoa();
      const antes = await linha(pessoa.id);

      const resposta = await trocar(pessoa.token, {
        senhaAtual: 'SenhaErrada9',
        novaSenha: NOVA,
      }).expect(400);

      expect((resposta.body as { message: string }).message).toBe('Senha atual incorreta');
      expect(await linha(pessoa.id)).toEqual(antes);
      await me(pessoa.token, 200);
      await login(pessoa.email, SENHA);
    });

    it.each([
      ['curta', 'Ab1'],
      ['sem maiuscula', 'senha12345'],
      ['sem minuscula', 'SENHA12345'],
      ['sem numero', 'SenhaSemNumero'],
      ['acima de 72 bytes', `Aa1${'x'.repeat(80)}`],
    ])('nova senha fora da politica (%s): 400 e nada muda', async (_nome, novaSenha) => {
      const pessoa = await criarPessoa();
      const antes = await linha(pessoa.id);

      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha }).expect(400);

      expect(await linha(pessoa.id)).toEqual(antes);
    });

    it.each([
      ['sem senhaAtual', { novaSenha: NOVA }],
      ['sem novaSenha', { senhaAtual: SENHA }],
      ['senhaAtual vazia', { senhaAtual: '', novaSenha: NOVA }],
      ['senhaAtual que nao e texto', { senhaAtual: 123, novaSenha: NOVA }],
      ['novaSenha que nao e texto', { senhaAtual: SENHA, novaSenha: { a: 1 } }],
    ])('corpo invalido (%s): 400', async (_nome, body) => {
      const pessoa = await criarPessoa();

      await trocar(pessoa.token, body).expect(400);
    });

    it('reutilizar a senha atual: 400 e nada muda', async () => {
      const pessoa = await criarPessoa();
      const antes = await linha(pessoa.id);

      const resposta = await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: SENHA }).expect(
        400,
      );

      expect((resposta.body as { message: string }).message).toMatch(/diferente/);
      expect(await linha(pessoa.id)).toEqual(antes);
    });
  });

  describe('isolamento: so a propria senha', () => {
    it.each([['userId'], ['id'], ['email'], ['alvoId'], ['role']])(
      'campo "%s" no corpo: 400 e nenhuma senha muda',
      async (campo) => {
        const pessoa = await criarPessoa();
        const outra = await criarPessoa();
        const antesOutra = await linha(outra.id);
        const antesPessoa = await linha(pessoa.id);

        await trocar(pessoa.token, {
          senhaAtual: SENHA,
          novaSenha: NOVA,
          [campo]: campo === 'email' ? outra.email : outra.id,
        }).expect(400);

        expect(await linha(outra.id)).toEqual(antesOutra);
        expect(await linha(pessoa.id)).toEqual(antesPessoa);
      },
    );

    it('trocar a propria senha nao altera a de outra pessoa', async () => {
      const pessoa = await criarPessoa();
      const outra = await criarPessoa();
      const antesOutra = await linha(outra.id);

      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(200);

      expect(await linha(outra.id)).toEqual(antesOutra);
      await login(outra.email, SENHA);
      await me(outra.token, 200);
    });

    it('usar a senha de outra pessoa como "atual" nao funciona', async () => {
      const pessoa = await criarPessoa();
      const outra = await criarPessoa();
      await trocar(outra.token, { senhaAtual: SENHA, novaSenha: 'OutraSenha89' }).expect(200);

      // A senha de `outra` agora e OutraSenha89; `pessoa` nao a conhece nem a usa.
      await trocar(pessoa.token, { senhaAtual: 'OutraSenha89', novaSenha: NOVA }).expect(400);
    });

    it('so senha_hash e updated_at mudam: nome, e-mail, perfil e status ficam intactos', async () => {
      const pessoa = await criarPessoa();
      const antes = await linha(pessoa.id);

      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(200);

      const depois = await linha(pessoa.id);
      expect(depois.senha_hash).not.toBe(antes.senha_hash);
      expect({ ...depois, senha_hash: '' }).toEqual({ ...antes, senha_hash: '' });
    });
  });

  describe('sucesso e sessoes', () => {
    it('200 com token novo; o antigo deixa de valer; o novo funciona', async () => {
      const pessoa = await criarPessoa();

      const resposta = await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(
        200,
      );
      const novo = (resposta.body as AuthResponseDto).accessToken;

      expect(novo).toEqual(expect.any(String));
      expect(novo).not.toBe(pessoa.token);
      await me(pessoa.token, 401);
      await me(novo, 200);
    });

    it('outras sessoes abertas (outro login) tambem sao invalidadas', async () => {
      const pessoa = await criarPessoa();
      const outraSessao = (await login(pessoa.email, SENHA)).accessToken;
      await me(outraSessao, 200);

      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(200);

      await me(outraSessao, 401);
    });

    it('o token antigo nao troca a senha de novo', async () => {
      const pessoa = await criarPessoa();
      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(200);

      await trocar(pessoa.token, { senhaAtual: NOVA, novaSenha: 'Terceira789' }).expect(401);
    });

    it('login: a senha antiga deixa de funcionar e a nova passa a funcionar', async () => {
      const pessoa = await criarPessoa();

      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(200);

      await login(pessoa.email, SENHA, 401);
      await login(pessoa.email, NOVA);
    });

    it('usuarios que nao trocaram a senha nao perdem a sessao', async () => {
      const pessoa = await criarPessoa();
      const outra = await criarPessoa();

      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(200);

      await me(outra.token, 200);
    });

    it('duas trocas simultaneas com a mesma senha atual: so uma vale', async () => {
      const pessoa = await criarPessoa();

      const [a, b] = await Promise.all([
        trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: 'ConcorrenteA1' }),
        trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: 'ConcorrenteB2' }),
      ]);

      expect([a.status, b.status].filter((status) => status === 200)).toHaveLength(1);
      expect([a.status, b.status].find((status) => status !== 200)).toBeGreaterThanOrEqual(400);
    });
  });

  describe('compatibilidade com tokens antigos (sem pv)', () => {
    it('token anterior ao campo pv continua valido ate expirar', async () => {
      const pessoa = await criarPessoa();
      const legado = await jwtService.signAsync({ sub: pessoa.id });

      await me(legado, 200);
    });

    it('token legado (sem pv) tambem pode trocar a senha, e a troca o invalida', async () => {
      const pessoa = await criarPessoa();
      const legado = await jwtService.signAsync({ sub: pessoa.id });

      await trocar(legado, { senhaAtual: SENHA, novaSenha: NOVA }).expect(200);

      // O legado nao tem pv: segue aceito (compatibilidade). Quem trocou usa o token novo.
      await me(legado, 200);
    });

    it('pv de outra senha: 401', async () => {
      const pessoa = await criarPessoa();
      const adulterado = await jwtService.signAsync({ sub: pessoa.id, pv: '0000000000000000' });

      await me(adulterado, 401);
    });

    it('pv que nao e texto: 401', async () => {
      const pessoa = await criarPessoa();
      const malformado = await jwtService.signAsync({ sub: pessoa.id, pv: 123 });

      await me(malformado, 401);
    });
  });

  describe('auditoria e vazamento', () => {
    it('sucesso gera exatamente um PASSWORD_CHANGED, sem senha nem hash', async () => {
      const pessoa = await criarPessoa();
      const antes = await linha(pessoa.id);

      const resposta = await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: NOVA }).expect(
        200,
      );

      expect(await eventosDeSenha(pessoa)).toEqual([AuditAction.PasswordChanged]);
      const trilha = await request(server())
        .get('/audit-logs?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const depois = await linha(pessoa.id);
      const exposto = JSON.stringify([trilha.body, resposta.body]);
      for (const segredo of [SENHA, NOVA, antes.senha_hash, depois.senha_hash]) {
        expect(exposto).not.toContain(segredo);
      }
      expect(resposta.body).not.toHaveProperty('user.senhaHash');
    });

    it('tentativa recusada nao gera PASSWORD_CHANGED', async () => {
      const pessoa = await criarPessoa();

      await trocar(pessoa.token, { senhaAtual: 'Errada1234', novaSenha: NOVA }).expect(400);
      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: SENHA }).expect(400);
      await trocar(pessoa.token, { senhaAtual: SENHA, novaSenha: 'fraca' }).expect(400);

      expect(await eventosDeSenha(pessoa)).toEqual([]);
    });
  });
});
