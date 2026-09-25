import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { Role } from '../src/modules/roles/entities/role.entity';
import type { ProfileResponseDto } from '../src/modules/users/dto/profile-response.dto';
import type { UserResponseDto } from '../src/modules/users/dto/user-response.dto';
import { toUserResponse } from '../src/modules/users/dto/user-response.dto';
import { ProfileService } from '../src/modules/users/profile.service';
import { UsersRepository } from '../src/modules/users/users.repository';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';

interface Pessoa {
  id: string;
  email: string;
  token: string;
}

describe('Perfil do usuario (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let dataSource: DataSource;
  let adminToken: string;
  /** Perfil sem nenhuma permissao: o perfil proprio nao e privilegio administrativo. */
  let comum: Pessoa;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;
  const uniqueEmail = (prefix: string): string => `${prefix}${++counter}@vasta.test`;

  async function login(email: string, senha: string): Promise<AuthResponseDto> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return response.body as AuthResponseDto;
  }

  async function criarPessoa(prefix: string, role = RoleName.Usuario): Promise<Pessoa> {
    const email = uniqueEmail(prefix);
    const user = await usersService.create({
      nome: `Teste ${prefix}`,
      email,
      senha: VALID_PASSWORD,
      role,
    });
    return { id: user.id, email, token: (await login(email, VALID_PASSWORD)).accessToken };
  }

  async function lerPerfil(pessoa: Pessoa): Promise<ProfileResponseDto> {
    const response = await request(server())
      .get('/profile')
      .set('Authorization', bearer(pessoa.token))
      .expect(200);
    return response.body as ProfileResponseDto;
  }

  async function alterar(
    pessoa: Pessoa,
    body: object,
    esperado: number,
  ): Promise<ProfileResponseDto> {
    const response = await request(server())
      .patch('/profile')
      .set('Authorization', bearer(pessoa.token))
      .send(body)
      .expect(esperado);
    return response.body as ProfileResponseDto;
  }

  /** A linha do usuario como ela esta no banco, sem passar pela API. */
  async function linhaNoBanco(
    id: string,
  ): Promise<{ nome: string; email: string; ativo: boolean; role_id: string }> {
    const [linha] = await dataSource.query<
      { nome: string; email: string; ativo: number; role_id: string }[]
    >('SELECT nome, email, ativo, role_id FROM users WHERE id = ?', [id]);
    return { ...linha, ativo: Boolean(linha.ativo) };
  }

  /** Eventos de auditoria cujo alvo e a pessoa informada. */
  async function auditoriaDe(pessoa: Pessoa): Promise<string[]> {
    const response = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    return (response.body as AuditLogPageResponseDto).items
      .filter((log) => log.metadados?.alvoId === pessoa.id)
      .map((log) => log.acao);
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    dataSource = app.get(DataSource, { strict: false });
    adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
  });

  beforeEach(async () => {
    // Pessoa nova a cada teste: o estado de uma nao contamina a seguinte.
    comum = await criarPessoa('comum');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('acesso', () => {
    it.each([
      ['leitura', 'get' as const],
      ['alteracao', 'patch' as const],
    ])('%s sem token: 401', async (_nome, metodo) => {
      await request(server())[metodo]('/profile').expect(401);
    });

    it.each([RoleName.Admin, RoleName.Gestor, RoleName.Operador, RoleName.Usuario])(
      'perfil %s acessa o proprio perfil, sem permissao granular',
      async (role) => {
        const pessoa = await criarPessoa('perfil', role);

        expect((await lerPerfil(pessoa)).email).toBe(pessoa.email);
      },
    );

    it('nao existe rota para criar perfil', async () => {
      await request(server())
        .post('/profile')
        .set('Authorization', bearer(comum.token))
        .send({ nome: 'x' })
        .expect(404);
    });

    it('nao existe rota para apagar perfil', async () => {
      await request(server())
        .delete('/profile')
        .set('Authorization', bearer(comum.token))
        .expect(404);
    });

    it.each([
      ['role', '/profile/role'],
      ['permissoes', '/profile/permissions'],
    ])('nao existe rota para alterar %s pelo perfil', async (_nome, rota) => {
      await request(server())
        .patch(rota)
        .set('Authorization', bearer(comum.token))
        .send({ role: 'ADMIN' })
        .expect(404);
    });

    it('nao ha parametro de usuario na rota: /profile/<id> nao existe', async () => {
      await request(server())
        .get(`/profile/${comum.id}`)
        .set('Authorization', bearer(comum.token))
        .expect(404);
    });
  });

  describe('GET /profile', () => {
    it('devolve os dados do proprio usuario', async () => {
      expect(await lerPerfil(comum)).toMatchObject({
        id: comum.id,
        email: comum.email,
        nome: 'Teste comum',
        role: RoleName.Usuario,
        ativo: true,
      });
    });

    it('cada um recebe o seu, nunca o de outra pessoa', async () => {
      const outra = await criarPessoa('outra');

      expect((await lerPerfil(comum)).id).toBe(comum.id);
      expect((await lerPerfil(outra)).id).toBe(outra.id);
      expect((await lerPerfil(comum)).id).not.toBe(outra.id);
    });

    it('nao expoe hash de senha nem lista de permissoes', async () => {
      const perfil = await lerPerfil(comum);

      expect(Object.keys(perfil).sort()).toEqual(
        ['ativo', 'createdAt', 'email', 'id', 'nome', 'role', 'updatedAt'].sort(),
      );
      expect(JSON.stringify(perfil)).not.toContain('$2b$');
    });

    it('nao gera registro de auditoria', async () => {
      const antes = await auditoriaDe(comum);

      await lerPerfil(comum);
      await lerPerfil(comum);

      expect(await auditoriaDe(comum)).toEqual(antes);
    });
  });

  describe('PATCH /profile', () => {
    it('altera o nome e devolve o perfil atualizado', async () => {
      const atualizado = await alterar(comum, { nome: 'Nome Novo' }, 200);

      expect(atualizado.nome).toBe('Nome Novo');
      expect((await lerPerfil(comum)).nome).toBe('Nome Novo');
    });

    it('preserva e-mail, perfil, status e id', async () => {
      const antes = await lerPerfil(comum);

      const depois = await alterar(comum, { nome: 'Nome Novo' }, 200);

      expect(depois).toMatchObject({
        id: antes.id,
        email: antes.email,
        role: antes.role,
        ativo: antes.ativo,
        createdAt: antes.createdAt,
      });
    });

    it('a alteracao vale tambem em /auth/me: e o mesmo usuario', async () => {
      await alterar(comum, { nome: 'Nome Novo' }, 200);

      const response = await request(server())
        .get('/auth/me')
        .set('Authorization', bearer(comum.token))
        .expect(200);

      expect((response.body as UserResponseDto).nome).toBe('Nome Novo');
    });

    it('nao alcanca o perfil de outra pessoa', async () => {
      const outra = await criarPessoa('outra');

      await alterar(comum, { nome: 'So da Comum' }, 200);

      expect((await lerPerfil(outra)).nome).toBe('Teste outra');
    });

    it('remove espacos nas pontas do nome', async () => {
      expect((await alterar(comum, { nome: '  Espacada  ' }, 200)).nome).toBe('Espacada');
    });

    /**
     * A prova de que nada foi gravado NAO e a comparacao de `updatedAt`: no
     * MySQL o `updated_at` do perfil e escrito com precisao de segundo, entao
     * duas requisicoes no mesmo segundo teriam o mesmo valor mesmo se houvesse
     * gravacao. Aqui a prova e a linha do banco inalterada MAIS a ausencia de
     * evento na trilha - nenhuma das duas depende de relogio.
     */
    it('corpo vazio: 200, sem alterar a linha e sem auditar', async () => {
      const antes = await linhaNoBanco(comum.id);
      const auditoriaAntes = await auditoriaDe(comum);

      const depois = await alterar(comum, {}, 200);

      expect(depois.nome).toBe(antes.nome);
      expect(await linhaNoBanco(comum.id)).toEqual(antes);
      expect(await auditoriaDe(comum)).toEqual(auditoriaAntes);
    });

    it('mesmo nome: 200, sem alterar a linha e sem auditar', async () => {
      const antes = await linhaNoBanco(comum.id);
      const auditoriaAntes = await auditoriaDe(comum);

      await alterar(comum, { nome: antes.nome }, 200);

      expect(await linhaNoBanco(comum.id)).toEqual(antes);
      expect(await auditoriaDe(comum)).toEqual(auditoriaAntes);
    });

    it.each([
      ['nome vazio', { nome: '' }],
      ['nome so com espacos', { nome: '   ' }],
      ['nome acima de 120 caracteres', { nome: 'a'.repeat(121) }],
      ['nome nao textual', { nome: 42 }],
    ])('recusa %s com 400', async (_nome, body) => {
      await alterar(comum, body, 400);
    });
  });

  describe('campos que o perfil nao aceita', () => {
    /**
     * Recusados pelo CONTRATO (`forbidNonWhitelisted`), e nao ignorados em
     * silencio: o cliente recebe 400 e sabe que a tentativa falhou.
     */
    it.each([
      ['role', { role: 'ADMIN' }],
      ['ativo', { ativo: false }],
      ['id', { id: 'outro-id' }],
      ['userId', { userId: 'outro-id' }],
      ['usuarioId', { usuarioId: 'outro-id' }],
      ['senha', { senha: 'OutraSenha1' }],
      ['senhaHash', { senhaHash: 'hash-falso' }],
      ['email', { email: 'outro@vasta.test' }],
      ['permissions', { permissions: ['users:read'] }],
      ['permissoes junto de um campo valido', { nome: 'Nome Novo', permissions: ['users:read'] }],
    ])('recusa %s com 400', async (_nome, body) => {
      await alterar(comum, body, 400);
    });

    it('nenhuma dessas tentativas altera o usuario', async () => {
      const antes = await lerPerfil(comum);

      await alterar(comum, { nome: 'Nome Novo', role: 'ADMIN' }, 400);
      await alterar(comum, { ativo: false }, 400);
      await alterar(comum, { email: 'outro@vasta.test' }, 400);

      expect(await lerPerfil(comum)).toEqual(antes);
    });

    it('a tentativa de virar ADMIN nao muda as permissoes em /auth/me', async () => {
      await alterar(comum, { role: 'ADMIN' }, 400);

      const response = await request(server())
        .get('/auth/me')
        .set('Authorization', bearer(comum.token))
        .expect(200);

      expect((response.body as UserResponseDto).role).toBe(RoleName.Usuario);
      expect((response.body as UserResponseDto).permissions).toEqual([]);
    });

    it('a senha continua valendo depois da tentativa de troca-la', async () => {
      await alterar(comum, { senha: 'OutraSenha1' }, 400);

      // A senha original ainda autentica: nada foi gravado.
      await request(server())
        .post('/auth/login')
        .send({ email: comum.email, senha: VALID_PASSWORD })
        .expect(200);
    });
  });

  describe('auditoria', () => {
    it('a alteracao gera exatamente um USER_UPDATED', async () => {
      await alterar(comum, { nome: 'Nome Novo' }, 200);

      expect(await auditoriaDe(comum)).toEqual(['USER_UPDATED']);
    });

    it('registra os campos alterados, nunca os valores', async () => {
      await alterar(comum, { nome: 'Nome Bem Especifico' }, 200);

      const response = await request(server())
        .get('/audit-logs?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const evento = (response.body as AuditLogPageResponseDto).items.find(
        (log) => log.metadados?.alvoId === comum.id,
      );

      expect(evento?.metadados).toEqual({ alvoId: comum.id, campos: ['nome'] });

      // O que a trilha GUARDA sao `descricao` e `metadados`; o bloco `usuario`
      // nao esta gravado - a tela resolve a identidade a partir de `usuarioId`
      // a cada leitura. Por isso a verificacao mira nos dois campos gravados, e
      // nao no corpo inteiro da resposta.
      const gravado = JSON.stringify({
        descricao: evento?.descricao,
        metadados: evento?.metadados,
      });
      expect(gravado).not.toContain('Nome Bem Especifico');
      expect(gravado).not.toContain('Teste comum');
    });

    it('o registro identifica quem executou, e o alvo e ele mesmo', async () => {
      await alterar(comum, { nome: 'Nome Novo' }, 200);

      const response = await request(server())
        .get('/audit-logs?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const evento = (response.body as AuditLogPageResponseDto).items.find(
        (log) => log.metadados?.alvoId === comum.id,
      );

      expect(evento?.usuarioId).toBe(comum.id);
      expect(evento?.usuario).toMatchObject({ id: comum.id });
    });

    it('a trilha nao guarda o e-mail do usuario', async () => {
      await alterar(comum, { nome: 'Nome Novo' }, 200);

      const response = await request(server())
        .get('/audit-logs?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const evento = (response.body as AuditLogPageResponseDto).items.find(
        (log) => log.metadados?.alvoId === comum.id,
      );

      expect(evento?.descricao).not.toContain(comum.email);
    });

    it('corpo sem alteracao nao gera evento', async () => {
      const antes = await auditoriaDe(comum);

      await alterar(comum, {}, 200);
      await alterar(comum, { nome: 'Teste comum' }, 200);

      expect(await auditoriaDe(comum)).toEqual(antes);
    });

    it('tentativa recusada nao gera evento', async () => {
      const antes = await auditoriaDe(comum);

      await alterar(comum, { role: 'ADMIN' }, 400);

      expect(await auditoriaDe(comum)).toEqual(antes);
    });
  });

  /**
   * A correcao do achado da revisao: o `PATCH /profile` grava com um UPDATE
   * DIRECIONADO a coluna `nome`, e nao com `save(entity)`.
   *
   * Com `save`, o TypeORM compara a entidade carregada com a linha atual e
   * reescreve TODA coluna que diferir. Uma desativacao, um rebaixamento de
   * perfil ou uma troca de e-mail feitos entre a leitura e a gravacao voltariam
   * atras - o usuario se reativaria, ou recuperaria um perfil recem-revogado.
   *
   * Estes testes usam o banco de verdade da suite e o `ProfileService` de
   * verdade. O unico ponto simulado e o INSTANTE da alteracao administrativa:
   * ela e aplicada no banco no momento exato em que a gravacao do perfil vai
   * acontecer - que e, justamente, o instante que o `save` nao sobrevivia.
   */
  describe('alteracao administrativa concorrente', () => {
    let profileService: ProfileService;
    let usersRepository: UsersRepository;

    beforeAll(() => {
      profileService = app.get(ProfileService, { strict: false });
      usersRepository = app.get(UsersRepository, { strict: false });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** O usuario como o `JwtAuthGuard` o entregaria: lido do banco AGORA. */
    async function atorAutenticado(id: string): Promise<AuthenticatedUser> {
      const user = await usersRepository.findById(id);
      if (!user) {
        throw new Error('usuario de teste nao encontrado');
      }
      return toUserResponse(user);
    }

    /**
     * Faz a alteracao administrativa cair EXATAMENTE entre a leitura do perfil
     * e a sua gravacao, e devolve os valores que o admin gravou.
     */
    async function adminAlteraDuranteAGravacao(
      id: string,
    ): Promise<{ ativo: boolean; email: string; roleId: string }> {
      const gestor = await dataSource.getRepository(Role).findOneByOrFail({
        nome: RoleName.Gestor,
      });
      const emailDoAdmin = uniqueEmail('trocado-pelo-admin');
      const real = usersRepository.updateName.bind(usersRepository);

      jest.spyOn(usersRepository, 'updateName').mockImplementation(async (alvo, nome, quando) => {
        // O admin desativa, troca o e-mail e rebaixa o perfil - tudo isso
        // depois de o perfil ter sido lido, e antes de ele ser gravado.
        await dataSource.query('UPDATE users SET ativo = 0, email = ?, role_id = ? WHERE id = ?', [
          emailDoAdmin,
          gestor.id,
          id,
        ]);
        return real(alvo, nome, quando);
      });

      return { ativo: false, email: emailDoAdmin, roleId: gestor.id };
    }

    it('a desativacao, a troca de e-mail e o rebaixamento sobrevivem ao PATCH', async () => {
      const ator = await atorAutenticado(comum.id);
      const doAdmin = await adminAlteraDuranteAGravacao(comum.id);

      await profileService.update(ator, { nome: 'Nome Do Perfil' }, null);

      const linha = await linhaNoBanco(comum.id);
      // O nome do proprio usuario foi gravado...
      expect(linha.nome).toBe('Nome Do Perfil');
      // ...e nada que o admin fez voltou atras.
      expect(linha.ativo).toBe(doAdmin.ativo);
      expect(linha.email).toBe(doAdmin.email);
      expect(linha.role_id).toBe(doAdmin.roleId);
    });

    it('o perfil revogado nao e restaurado: o usuario continua GESTOR', async () => {
      const ator = await atorAutenticado(comum.id);
      expect(ator.role).toBe(RoleName.Usuario);
      const doAdmin = await adminAlteraDuranteAGravacao(comum.id);

      await profileService.update(ator, { nome: 'Outro Nome' }, null);

      const [linha] = await dataSource.query<{ role: RoleName }[]>(
        'SELECT r.nome AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
        [comum.id],
      );
      expect(linha.role).toBe(RoleName.Gestor);
      expect((await linhaNoBanco(comum.id)).role_id).toBe(doAdmin.roleId);
    });

    it('a conta desativada nao se reativa sozinha', async () => {
      const ator = await atorAutenticado(comum.id);
      await adminAlteraDuranteAGravacao(comum.id);

      await profileService.update(ator, { nome: 'Mais Um Nome' }, null);

      expect((await linhaNoBanco(comum.id)).ativo).toBe(false);
    });

    /**
     * A propriedade que garante tudo acima, verificada na origem: o comando
     * emitido nao CITA nenhuma coluna administrativa. Se alguem voltar a usar
     * `save(entity)`, este teste falha mesmo sem concorrencia nenhuma.
     */
    it('o UPDATE emitido cita apenas nome e updated_at', async () => {
      const ator = await atorAutenticado(comum.id);
      const emitido: string[] = [];
      const original = dataSource.logger;
      dataSource.logger = {
        logQuery: (query: string) => emitido.push(query),
        logQueryError: () => undefined,
        logQuerySlow: () => undefined,
        logSchemaBuild: () => undefined,
        logMigration: () => undefined,
        log: () => undefined,
      };

      try {
        await profileService.update(ator, { nome: 'Nome Observado' }, null);
      } finally {
        dataSource.logger = original;
      }

      const updates = emitido.filter((q) => /^UPDATE\s+"?users"?/i.test(q.trim()));
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatch(/\bnome\b/);
      expect(updates[0]).toMatch(/\bupdated_at\b/);
      for (const coluna of ['email', 'senha_hash', 'ativo', 'role_id']) {
        expect(updates[0]).not.toContain(coluna);
      }
    });
  });
});
