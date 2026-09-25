import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import type { SystemSettingResponseDto } from '../src/modules/settings/dto/system-setting-response.dto';
import { SETTING_CATALOG } from '../src/modules/settings/setting-catalog';
import { SettingsRepository } from '../src/modules/settings/settings.repository';
import { SystemSettingType } from '../src/modules/settings/system-setting.enums';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';

/** Chave STRING do catalogo, usada nos testes de leitura e escrita. */
const TEXTO = 'SYSTEM_NAME';
/** Chave NUMBER do catalogo. */
const NUMERO = 'PAGINATION_DEFAULT_LIMIT';
/**
 * Chave BOOLEAN criada apenas para o teste.
 *
 * O catalogo de producao ainda nao tem configuracao booleana, e nao ha rota
 * para criar chave - entao a fixture entra pelo repositorio, como as demais
 * suites fazem com `usersService.create`. Nao e dado de producao.
 */
const BOOLEANO = 'TEST_FEATURE_ENABLED';

describe('Configuracoes do sistema (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let settingsRepository: SettingsRepository;
  let adminToken: string;
  /** GESTOR: administra usuarios e financeiro, mas NAO configuracoes. */
  let gestorToken: string;
  let semPermissaoToken: string;
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

  async function ler(chave: string, token = adminToken): Promise<SystemSettingResponseDto> {
    const response = await request(server())
      .get(`/settings/${chave}`)
      .set('Authorization', bearer(token))
      .expect(200);
    return response.body as SystemSettingResponseDto;
  }

  async function alterar(
    chave: string,
    body: object,
    esperado: number,
    token = adminToken,
  ): Promise<SystemSettingResponseDto> {
    const response = await request(server())
      .patch(`/settings/${chave}`)
      .set('Authorization', bearer(token))
      .send(body)
      .expect(esperado);
    return response.body as SystemSettingResponseDto;
  }

  /** Eventos de auditoria de configuracao para uma chave. */
  async function auditoriaDe(chave: string): Promise<string[]> {
    const response = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    return (response.body as AuditLogPageResponseDto).items
      .filter((log) => log.metadados?.chave === chave)
      .map((log) => log.acao);
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    settingsRepository = app.get(SettingsRepository, { strict: false });
    adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
    gestorToken = await tokenFor(RoleName.Gestor);
    semPermissaoToken = await tokenFor(RoleName.Usuario);

    await settingsRepository.create({
      chave: BOOLEANO,
      valor: 'false',
      descricao: 'Configuracao booleana usada nos testes',
      tipo: SystemSettingType.Boolean,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('acesso', () => {
    const rotas: [string, 'get' | 'patch', string][] = [
      ['lista', 'get', '/settings'],
      ['consulta', 'get', `/settings/${TEXTO}`],
      ['alteracao', 'patch', `/settings/${TEXTO}`],
    ];

    it.each(rotas)('%s sem token: 401', async (_nome, metodo, rota) => {
      await request(server())[metodo](rota).expect(401);
    });

    it.each(rotas)('%s com token de perfil sem permissao: 403', async (_nome, metodo, rota) => {
      await request(server())
        [metodo](rota)
        .set('Authorization', bearer(semPermissaoToken))
        .send({ valor: 'x' })
        .expect(403);
    });

    /**
     * GESTOR tem permissoes administrativas em usuarios e financeiro, e mesmo
     * assim NAO enxerga as configuracoes: elas sao exclusivas do ADMIN nesta
     * etapa. Ter outras permissoes administrativas nao da acesso a estas.
     */
    it.each(rotas)('%s com token de GESTOR: 403', async (_nome, metodo, rota) => {
      await request(server())
        [metodo](rota)
        .set('Authorization', bearer(gestorToken))
        .send({ valor: 'x' })
        .expect(403);
    });

    it('nao existe rota para criar configuracao', async () => {
      await request(server())
        .post('/settings')
        .set('Authorization', bearer(adminToken))
        .send({ chave: 'NOVA', valor: 'x', tipo: 'STRING', descricao: 'x' })
        .expect(404);
    });

    it('nao existe rota para apagar configuracao', async () => {
      await request(server())
        .delete(`/settings/${TEXTO}`)
        .set('Authorization', bearer(adminToken))
        .expect(404);
    });
  });

  describe('GET /settings', () => {
    it('lista as configuracoes semeadas pelo catalogo', async () => {
      const response = await request(server())
        .get('/settings')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const itens = response.body as SystemSettingResponseDto[];
      const chaves = itens.map((item) => item.chave);

      for (const definicao of SETTING_CATALOG) {
        expect(chaves).toContain(definicao.chave);
      }
    });

    it('vem ordenada pela chave', async () => {
      const response = await request(server())
        .get('/settings')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const chaves = (response.body as SystemSettingResponseDto[]).map((item) => item.chave);

      expect(chaves).toEqual([...chaves].sort());
    });

    it('cada item traz valor tipado, descricao, tipo e ultima atualizacao', async () => {
      const response = await request(server())
        .get('/settings')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const texto = (response.body as SystemSettingResponseDto[]).find(
        (item) => item.chave === TEXTO,
      );

      expect(texto).toMatchObject({
        tipo: SystemSettingType.String,
        valor: expect.any(String) as string,
        descricao: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
    });

    it('nao expoe o id interno da linha nem campo de segredo', async () => {
      const response = await request(server())
        .get('/settings')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const [primeiro] = response.body as SystemSettingResponseDto[];

      expect(Object.keys(primeiro).sort()).toEqual(
        [
          'atualizadoPor',
          'atualizadoPorId',
          'chave',
          'createdAt',
          'descricao',
          'tipo',
          'updatedAt',
          'valor',
        ].sort(),
      );
    });
  });

  describe('GET /settings/:key', () => {
    it.each([
      ['STRING', TEXTO, 'string'],
      ['NUMBER', NUMERO, 'number'],
      ['BOOLEAN', BOOLEANO, 'boolean'],
    ])('devolve o valor de uma configuracao %s no tipo certo', async (_nome, chave, tipoJs) => {
      const setting = await ler(chave);

      expect(typeof setting.valor).toBe(tipoJs);
    });

    it('chave inexistente: 404', async () => {
      await request(server())
        .get('/settings/NAO_EXISTE')
        .set('Authorization', bearer(adminToken))
        .expect(404);
    });
  });

  describe('PATCH /settings/:key', () => {
    it('altera o valor e a mudanca fica persistida', async () => {
      const atualizado = await alterar(TEXTO, { valor: 'VastaFlow Producao' }, 200);

      expect(atualizado.valor).toBe('VastaFlow Producao');
      expect((await ler(TEXTO)).valor).toBe('VastaFlow Producao');

      await alterar(TEXTO, { valor: 'VastaFlow' }, 200);
    });

    it('registra quem alterou, com nome e e-mail resolvidos', async () => {
      const atualizado = await alterar(NUMERO, { valor: 25 }, 200);

      expect(atualizado.atualizadoPor).toMatchObject({ email: ADMIN.email });
      expect(atualizado.atualizadoPorId).toBe(atualizado.atualizadoPor?.id);

      await alterar(NUMERO, { valor: 20 }, 200);
    });

    it.each([
      ['NUMBER', NUMERO, 50, 50],
      ['BOOLEAN', BOOLEANO, true, true],
    ])('aceita e devolve o valor %s no tipo declarado', async (_nome, chave, entrada, esperado) => {
      const atualizado = await alterar(chave, { valor: entrada }, 200);

      expect(atualizado.valor).toBe(esperado);
      expect((await ler(chave)).valor).toBe(esperado);
    });

    it('chave inexistente: 404 ', async () => {
      await alterar('NAO_EXISTE', { valor: 'x' }, 404);
    });

    describe('payload invalido', () => {
      it.each([
        ['corpo vazio', TEXTO, {}],
        ['valor nulo', TEXTO, { valor: null }],
        ['valor objeto', TEXTO, { valor: { nome: 'x' } }],
        ['valor lista', TEXTO, { valor: ['x'] }],
        ['numero numa chave STRING', TEXTO, { valor: 20 }],
        ['texto vazio numa chave STRING', TEXTO, { valor: '   ' }],
        ['texto numa chave NUMBER', NUMERO, { valor: '50' }],
        ['booleano numa chave NUMBER', NUMERO, { valor: true }],
        ['a string "false" numa chave BOOLEAN', BOOLEANO, { valor: 'false' }],
        ['o numero 0 numa chave BOOLEAN', BOOLEANO, { valor: 0 }],
      ])('recusa %s com 400', async (_nome, chave, body) => {
        await alterar(chave, body, 400);
      });

      it('a string "false" nao vira true por coercao: o valor no banco nao muda', async () => {
        await alterar(BOOLEANO, { valor: false }, 200);

        await alterar(BOOLEANO, { valor: 'false' }, 400);

        expect((await ler(BOOLEANO)).valor).toBe(false);
      });
    });

    describe('campos que o cliente nao pode alterar', () => {
      it.each([
        ['chave', { valor: 'x', chave: 'OUTRA' }],
        ['tipo', { valor: 'x', tipo: 'NUMBER' }],
        ['descricao', { valor: 'x', descricao: 'outra' }],
        ['o responsavel', { valor: 'x', atualizadoPorId: 'outro-usuario' }],
        ['o responsavel por usuarioId', { valor: 'x', usuarioId: 'outro-usuario' }],
      ])('enviar %s resulta em 400', async (_nome, body) => {
        await alterar(TEXTO, body, 400);
      });

      it('nenhuma dessas tentativas altera a configuracao', async () => {
        const antes = await ler(TEXTO);

        await alterar(TEXTO, { valor: 'x', tipo: 'NUMBER' }, 400);

        const depois = await ler(TEXTO);
        expect(depois).toMatchObject({
          chave: antes.chave,
          valor: antes.valor,
          tipo: antes.tipo,
          descricao: antes.descricao,
          atualizadoPorId: antes.atualizadoPorId,
        });
      });
    });
  });

  describe('auditoria', () => {
    it('a alteracao gera exatamente um SYSTEM_SETTING_UPDATED', async () => {
      const setting = await settingsRepository.create({
        chave: 'TEST_AUDIT_ONE',
        valor: 'antes',
        descricao: 'Configuracao usada no teste de auditoria',
        tipo: SystemSettingType.String,
      });

      await alterar(setting.chave, { valor: 'depois' }, 200);

      expect(await auditoriaDe(setting.chave)).toEqual(['SYSTEM_SETTING_UPDATED']);
    });

    it('a trilha nao guarda o valor anterior nem o novo', async () => {
      const setting = await settingsRepository.create({
        chave: 'TEST_AUDIT_VALUES',
        valor: 'ValorBemAntigo',
        descricao: 'Configuracao usada no teste de auditoria',
        tipo: SystemSettingType.String,
      });

      await alterar(setting.chave, { valor: 'ValorBemNovo' }, 200);

      const response = await request(server())
        .get('/audit-logs?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const registro = JSON.stringify(
        (response.body as AuditLogPageResponseDto).items.filter(
          (log) => log.metadados?.chave === setting.chave,
        ),
      );

      expect(registro).toContain(setting.chave);
      expect(registro).not.toContain('ValorBemAntigo');
      expect(registro).not.toContain('ValorBemNovo');
    });

    it('valor recusado nao entra na trilha', async () => {
      const setting = await settingsRepository.create({
        chave: 'TEST_AUDIT_REJECTED',
        valor: 'antes',
        descricao: 'Configuracao usada no teste de auditoria',
        tipo: SystemSettingType.String,
      });

      await alterar(setting.chave, { valor: 42 }, 400);

      expect(await auditoriaDe(setting.chave)).toEqual([]);
      expect((await ler(setting.chave)).valor).toBe('antes');
    });

    it('reenviar o mesmo valor nao gera novo registro', async () => {
      const setting = await settingsRepository.create({
        chave: 'TEST_AUDIT_NOOP',
        valor: 'igual',
        descricao: 'Configuracao usada no teste de auditoria',
        tipo: SystemSettingType.String,
      });

      await alterar(setting.chave, { valor: 'igual' }, 200);

      expect(await auditoriaDe(setting.chave)).toEqual([]);
    });

    it('a consulta nao gera evento de auditoria', async () => {
      const antes = (await auditoriaDe(TEXTO)).length;

      await request(server()).get('/settings').set('Authorization', bearer(adminToken)).expect(200);
      await ler(TEXTO);

      expect(await auditoriaDe(TEXTO)).toHaveLength(antes);
    });
  });
});
