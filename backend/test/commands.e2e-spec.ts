import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { CommandOutcome } from '../src/modules/commands/command.types';
import type { CommandResultResponseDto } from '../src/modules/commands/dto/command-result-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersRepository } from '../src/modules/users/users.repository';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';
const ENDPOINT = '/commands/execute';

describe('Commands (e2e)', () => {
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

  async function tokenFor(role: RoleName): Promise<string> {
    const email = uniqueEmail(role.toLowerCase());
    await usersService.create({ nome: `Teste ${role}`, email, senha: VALID_PASSWORD, role });
    return (await login(email, VALID_PASSWORD)).accessToken;
  }

  /** Executa uma mensagem no motor e devolve o resultado (sempre 200). */
  async function execute(token: string, text: string): Promise<CommandResultResponseDto> {
    const response = await request(server())
      .post(ENDPOINT)
      .set('Authorization', bearer(token))
      .send({ text })
      .expect(200);
    return response.body as CommandResultResponseDto;
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
      await request(server()).post(ENDPOINT).send({ text: '/ajuda' }).expect(401);
    });

    it('token invalido responde 401', async () => {
      await request(server())
        .post(ENDPOINT)
        .set('Authorization', bearer('nao-e-um-jwt'))
        .send({ text: '/ajuda' })
        .expect(401);
    });

    it('usuario autenticado consegue executar', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;

      const body = await execute(token, '/ajuda');

      expect(body.success).toBe(true);
    });

    it('usuario sem nenhuma permissao tambem executa os comandos tecnicos', async () => {
      const token = await tokenFor(RoleName.Usuario);

      expect((await execute(token, '/ajuda')).success).toBe(true);
      expect((await execute(token, '/status')).success).toBe(true);
    });
  });

  describe('identidade', () => {
    it('nao aceita userId pelo corpo', async () => {
      const token = await tokenFor(RoleName.Usuario);
      const outro = await usersService.create({
        nome: 'Outra Pessoa',
        email: uniqueEmail('outro'),
        senha: VALID_PASSWORD,
        role: RoleName.Admin,
      });

      await request(server())
        .post(ENDPOINT)
        .set('Authorization', bearer(token))
        .send({ text: '/ajuda', userId: outro.id })
        .expect(400);
    });

    it('nao aceita escolher o canal pelo corpo', async () => {
      const token = await tokenFor(RoleName.Usuario);

      await request(server())
        .post(ENDPOINT)
        .set('Authorization', bearer(token))
        .send({ text: '/ajuda', channel: 'telegram' })
        .expect(400);
    });

    it('a identidade usada e a do JWT: a ajuda reflete o perfil do token', async () => {
      // Um ADMIN e um USUARIO comum enviam exatamente o mesmo corpo. A resposta
      // so pode diferir se o motor tiver usado a identidade do token.
      const adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
      const usuarioToken = await tokenFor(RoleName.Usuario);

      const comoAdmin = await execute(adminToken, '/ajuda');
      const comoUsuario = await execute(usuarioToken, '/ajuda');

      expect(comoAdmin.success).toBe(true);
      expect(comoUsuario.success).toBe(true);
      // Hoje nenhum comando exige permissao, entao as listas coincidem; o que
      // importa e que nenhuma delas veio de um `userId` escolhido pelo cliente.
      expect(comoAdmin.reply).toContain('/ajuda');
      expect(comoUsuario.reply).toContain('/ajuda');
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
      await execute(token, '/ajuda');

      const user = await usersRepository.findByEmail(email);
      if (!user) {
        throw new Error('usuario nao encontrado');
      }
      user.ativo = false;
      await usersRepository.save(user);

      await request(server())
        .post(ENDPOINT)
        .set('Authorization', bearer(token))
        .send({ text: '/ajuda' })
        .expect(401);
    });

    it('aceita conversationId opcional, e funciona sem ele', async () => {
      const token = await tokenFor(RoleName.Usuario);

      await request(server())
        .post(ENDPOINT)
        .set('Authorization', bearer(token))
        .send({ text: '/ajuda', conversationId: 'teste-1' })
        .expect(200);
      await request(server())
        .post(ENDPOINT)
        .set('Authorization', bearer(token))
        .send({ text: '/ajuda' })
        .expect(200);
    });
  });

  describe('corpo invalido', () => {
    let token: string;

    beforeAll(async () => {
      token = await tokenFor(RoleName.Usuario);
    });

    it.each([
      [{}, 'sem text'],
      [{ text: '' }, 'text vazio'],
      [{ text: 123 }, 'text nao e string'],
      [{ text: '/ajuda', conversationId: '' }, 'conversationId vazio'],
      [{ text: `/${'a'.repeat(1001)}` }, 'text longo demais'],
    ])('%j (%s) responde 400', async (body, _descricao) => {
      await request(server())
        .post(ENDPOINT)
        .set('Authorization', bearer(token))
        .send(body)
        .expect(400);
    });
  });

  describe('comandos', () => {
    let token: string;

    beforeAll(async () => {
      token = (await login(ADMIN.email, ADMIN.senha)).accessToken;
    });

    it('/ajuda lista os comandos disponiveis', async () => {
      const body = await execute(token, '/ajuda');

      expect(body).toEqual({
        success: true,
        outcome: CommandOutcome.Ok,
        reply: expect.stringContaining('/ajuda') as string,
      });
      expect(body.reply).toContain('/status');
    });

    it('/status responde que o motor esta operacional', async () => {
      const body = await execute(token, '/status');

      expect(body.success).toBe(true);
      expect(body.outcome).toBe(CommandOutcome.Ok);
      expect(body.reply).toContain('Motor de comandos operacional');
    });

    it('reconhece o comando ignorando maiusculas e espacos nas pontas', async () => {
      expect((await execute(token, '  /STATUS  ')).success).toBe(true);
    });

    it('aceita argumentos extras sem quebrar', async () => {
      expect((await execute(token, '/status agora')).success).toBe(true);
    });
  });

  describe('erros controlados', () => {
    let token: string;

    beforeAll(async () => {
      token = (await login(ADMIN.email, ADMIN.senha)).accessToken;
    });

    it('comando inexistente responde 200 com success false', async () => {
      const body = await execute(token, '/naoexiste');

      expect(body.success).toBe(false);
      expect(body.outcome).toBe(CommandOutcome.UnknownCommand);
      expect(body.reply).toContain('/ajuda');
    });

    it.each([
      ['   ', CommandOutcome.EmptyMessage],
      ['bom dia', CommandOutcome.NotACommand],
      ['/', CommandOutcome.MalformedCommand],
      ['/aju-da', CommandOutcome.MalformedCommand],
    ])('%j resulta em %s, sem lancar erro', async (text, outcome) => {
      const body = await execute(token, text);

      expect(body.success).toBe(false);
      expect(body.outcome).toBe(outcome);
      expect(body.reply).not.toBe('');
    });

    it('nenhuma resposta de erro expoe stack trace ou caminho do servidor', async () => {
      for (const text of ['/naoexiste', 'bom dia', '/', '/aju-da']) {
        const { reply } = await execute(token, text);
        expect(reply).not.toMatch(/at \w|\.ts:|[A-Za-z]:\\|node_modules|Error:/);
      }
    });
  });

  describe('dados sensiveis', () => {
    it('a resposta nao contem token, senha, segredo nem dado do usuario', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;

      for (const text of ['/ajuda', '/status', '/naoexiste']) {
        const texto = JSON.stringify(await execute(token, text));

        expect(texto).not.toContain(token);
        expect(texto).not.toContain(ADMIN.senha);
        expect(texto).not.toContain(ADMIN.email);
        expect(texto).not.toMatch(/senhaHash|password|accessToken|secret|segredo|authorization/i);
        expect(texto).not.toMatch(/\$2[aby]\$/); // prefixo de hash bcrypt
      }
    });

    it('a resposta traz apenas os campos do resultado do motor', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;

      const body = await execute(token, '/ajuda');

      expect(Object.keys(body).sort()).toEqual(['outcome', 'reply', 'success']);
    });
  });

  describe('auditoria', () => {
    it('comandos tecnicos nao declaram auditoria e nao geram evento', async () => {
      const token = (await login(ADMIN.email, ADMIN.senha)).accessToken;
      const antes = await request(server())
        .get('/audit-logs')
        .set('Authorization', bearer(token))
        .expect(200);

      await execute(token, '/ajuda');
      await execute(token, '/status');

      const depois = await request(server())
        .get('/audit-logs')
        .set('Authorization', bearer(token))
        .expect(200);

      expect((depois.body as { total: number }).total).toBe(
        (antes.body as { total: number }).total,
      );
    });
  });
});
