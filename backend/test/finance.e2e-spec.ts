import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CommandResultResponseDto } from '../src/modules/commands/dto/command-result-response.dto';
import type { FinancialEntryPageResponseDto } from '../src/modules/finance/dto/financial-entry-page-response.dto';
import type { FinancialEntryResponseDto } from '../src/modules/finance/dto/financial-entry-response.dto';
import {
  FinancialEntryStatus,
  FinancialEntryType,
} from '../src/modules/finance/financial-entry.enums';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';

const NOVO_LANCAMENTO = {
  tipo: FinancialEntryType.Despesa,
  descricao: 'Compra de insumos',
  valor: 1500.5,
  data: '2026-09-23',
  categoria: 'Insumos',
};

describe('Financeiro (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let adminToken: string;
  /** GESTOR: tem as quatro permissoes financeiras pelo seeder. */
  let gestorToken: string;
  /** USUARIO: nenhuma permissao financeira. */
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

  async function criar(
    token = adminToken,
    body: object = NOVO_LANCAMENTO,
  ): Promise<FinancialEntryResponseDto> {
    const response = await request(server())
      .post('/finance/entries')
      .set('Authorization', bearer(token))
      .send(body)
      .expect(201);
    return response.body as FinancialEntryResponseDto;
  }

  async function executarComando(token: string, text: string): Promise<CommandResultResponseDto> {
    const response = await request(server())
      .post('/commands/execute')
      .set('Authorization', bearer(token))
      .send({ text })
      .expect(200);
    return response.body as CommandResultResponseDto;
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
    gestorToken = await tokenFor(RoleName.Gestor);
    semPermissaoToken = await tokenFor(RoleName.Usuario);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('acesso', () => {
    const rotas: [string, 'get' | 'post' | 'patch', string][] = [
      ['lista', 'get', '/finance/entries'],
      ['consulta', 'get', '/finance/entries/3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
      ['criacao', 'post', '/finance/entries'],
      ['edicao', 'patch', '/finance/entries/3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
      ['status', 'patch', '/finance/entries/3f2504e0-4f89-11d3-9a0c-0305e82c3301/status'],
    ];

    it.each(rotas)('%s sem JWT responde 401', async (_nome, metodo, rota) => {
      await request(server())[metodo](rota).expect(401);
    });

    it.each(rotas)('%s sem permissao financeira responde 403', async (_nome, metodo, rota) => {
      await request(server())
        [metodo](rota)
        .set('Authorization', bearer(semPermissaoToken))
        .send({})
        .expect(403);
    });

    it('GESTOR tem as quatro permissoes financeiras vindas do seeder', async () => {
      const { user } = await login(ADMIN.email, ADMIN.senha);
      expect(user.role).toBe(RoleName.Admin);

      const criado = await criar(gestorToken);
      await request(server())
        .get('/finance/entries')
        .set('Authorization', bearer(gestorToken))
        .expect(200);
      await request(server())
        .patch(`/finance/entries/${criado.id}`)
        .set('Authorization', bearer(gestorToken))
        .send({ descricao: 'Editado pelo gestor' })
        .expect(200);
      await request(server())
        .patch(`/finance/entries/${criado.id}/status`)
        .set('Authorization', bearer(gestorToken))
        .send({ status: FinancialEntryStatus.Pago })
        .expect(200);
    });
  });

  describe('POST /finance/entries', () => {
    it('cria o lancamento como PENDENTE, com o autor autenticado', async () => {
      const criado = await criar();

      expect(criado).toMatchObject({
        tipo: FinancialEntryType.Despesa,
        descricao: 'Compra de insumos',
        valor: 1500.5,
        data: '2026-09-23',
        categoria: 'Insumos',
        status: FinancialEntryStatus.Pendente,
        observacao: null,
      });
      expect(criado.criadoPor?.email).toBe(ADMIN.email);
      expect(typeof criado.valor).toBe('number');
    });

    it('nao aceita autor vindo do cliente', async () => {
      await request(server())
        .post('/finance/entries')
        .set('Authorization', bearer(adminToken))
        .send({ ...NOVO_LANCAMENTO, criadoPorId: 'outro-usuario' })
        .expect(400);
    });

    it('nao aceita status vindo do cliente', async () => {
      await request(server())
        .post('/finance/entries')
        .set('Authorization', bearer(adminToken))
        .send({ ...NOVO_LANCAMENTO, status: FinancialEntryStatus.Pago })
        .expect(400);
    });

    it.each([
      ['valor zero', { valor: 0 }],
      ['valor negativo', { valor: -10 }],
      ['valor com 3 casas decimais', { valor: 10.123 }],
      ['tipo invalido', { tipo: 'TRANSFERENCIA' }],
      ['descricao vazia', { descricao: '' }],
      ['descricao so com espacos', { descricao: '   ' }],
      ['categoria so com espacos', { categoria: '  ' }],
      ['observacao so com espacos', { observacao: '   ' }],
      ['data com hora', { data: '2026-09-23T10:00:00Z' }],
      ['data invalida', { data: '2026-13-45' }],
      ['data em outro formato', { data: '23/09/2026' }],
      ['descricao longa demais', { descricao: 'x'.repeat(201) }],
    ])('rejeita %s com 400', async (_nome, override) => {
      await request(server())
        .post('/finance/entries')
        .set('Authorization', bearer(adminToken))
        .send({ ...NOVO_LANCAMENTO, ...override })
        .expect(400);
    });

    it('aceita RECEITA e guarda o valor com as duas casas', async () => {
      const criado = await criar(adminToken, {
        ...NOVO_LANCAMENTO,
        tipo: FinancialEntryType.Receita,
        valor: 0.01,
        observacao: 'Entrada minima',
      });

      expect(criado.tipo).toBe(FinancialEntryType.Receita);
      expect(criado.valor).toBe(0.01);
      expect(criado.observacao).toBe('Entrada minima');
    });

    it('remove espacos das pontas dos textos', async () => {
      const criado = await criar(adminToken, {
        ...NOVO_LANCAMENTO,
        descricao: '  Com espacos  ',
        categoria: '  Insumos  ',
      });

      expect(criado.descricao).toBe('Com espacos');
      expect(criado.categoria).toBe('Insumos');
    });
  });

  describe('GET /finance/entries', () => {
    it('devolve items, total, page e limit', async () => {
      await criar();
      const response = await request(server())
        .get('/finance/entries')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const body = response.body as FinancialEntryPageResponseDto;

      expect(Object.keys(body).sort()).toEqual(['items', 'limit', 'page', 'total']);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.total).toBeGreaterThan(0);
    });

    it('pagina sem repetir lancamento entre paginas', async () => {
      for (let i = 0; i < 3; i += 1) {
        await criar(adminToken, { ...NOVO_LANCAMENTO, descricao: `Paginado ${i}` });
      }

      const pagina = async (page: number): Promise<FinancialEntryPageResponseDto> => {
        const response = await request(server())
          .get(`/finance/entries?page=${page}&limit=2`)
          .set('Authorization', bearer(adminToken))
          .expect(200);
        return response.body as FinancialEntryPageResponseDto;
      };

      const primeira = await pagina(1);
      const segunda = await pagina(2);

      expect(primeira.items).toHaveLength(2);
      expect(primeira.total).toBe(segunda.total);
      const ids = [...primeira.items, ...segunda.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('ordena por data decrescente', async () => {
      await criar(adminToken, { ...NOVO_LANCAMENTO, data: '2020-01-01' });
      await criar(adminToken, { ...NOVO_LANCAMENTO, data: '2030-12-31' });

      const response = await request(server())
        .get('/finance/entries?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const datas = (response.body as FinancialEntryPageResponseDto).items.map((item) => item.data);

      expect([...datas].sort().reverse()).toEqual(datas);
    });

    it('identifica o autor de cada lancamento', async () => {
      await criar();
      const response = await request(server())
        .get('/finance/entries?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const items = (response.body as FinancialEntryPageResponseDto).items;

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.criadoPor?.id).toBe(item.criadoPorId);
        expect(item.criadoPor?.email).toContain('@');
      }
    });

    it('rejeita paginacao invalida com 400', async () => {
      for (const query of ['?page=0', '?limit=0', '?limit=101', '?page=abc']) {
        await request(server())
          .get(`/finance/entries${query}`)
          .set('Authorization', bearer(adminToken))
          .expect(400);
      }
    });

    it('nao expoe hash de senha nem token', async () => {
      const response = await request(server())
        .get('/finance/entries?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const texto = JSON.stringify(response.body);

      expect(texto).not.toMatch(/senhaHash|senha_hash|password/i);
      expect(texto).not.toMatch(/\$2[aby]\$/);
      expect(texto).not.toContain(adminToken);
    });
  });

  describe('GET /finance/entries/:id', () => {
    it('devolve o lancamento pedido', async () => {
      const criado = await criar();

      const response = await request(server())
        .get(`/finance/entries/${criado.id}`)
        .set('Authorization', bearer(adminToken))
        .expect(200);

      expect((response.body as FinancialEntryResponseDto).id).toBe(criado.id);
    });

    it('lancamento inexistente responde 404', async () => {
      await request(server())
        .get('/finance/entries/3f2504e0-4f89-11d3-9a0c-0305e82c3301')
        .set('Authorization', bearer(adminToken))
        .expect(404);
    });

    it('id que nao e UUID responde 400', async () => {
      await request(server())
        .get('/finance/entries/nao-e-uuid')
        .set('Authorization', bearer(adminToken))
        .expect(400);
    });
  });

  describe('PATCH /finance/entries/:id', () => {
    it('edita os campos enviados', async () => {
      const criado = await criar();

      const response = await request(server())
        .patch(`/finance/entries/${criado.id}`)
        .set('Authorization', bearer(adminToken))
        .send({ descricao: 'Descricao nova', valor: 42.75 })
        .expect(200);
      const atualizado = response.body as FinancialEntryResponseDto;

      expect(atualizado.descricao).toBe('Descricao nova');
      expect(atualizado.valor).toBe(42.75);
      expect(atualizado.categoria).toBe(criado.categoria);
    });

    it('recusa alterar o status por esta rota', async () => {
      const criado = await criar();

      await request(server())
        .patch(`/finance/entries/${criado.id}`)
        .set('Authorization', bearer(adminToken))
        .send({ status: FinancialEntryStatus.Pago })
        .expect(400);
    });

    it('recusa valor invalido', async () => {
      const criado = await criar();

      await request(server())
        .patch(`/finance/entries/${criado.id}`)
        .set('Authorization', bearer(adminToken))
        .send({ valor: -1 })
        .expect(400);
    });

    it('lancamento inexistente responde 404', async () => {
      await request(server())
        .patch('/finance/entries/3f2504e0-4f89-11d3-9a0c-0305e82c3301')
        .set('Authorization', bearer(adminToken))
        .send({ descricao: 'x' })
        .expect(404);
    });
  });

  describe('PATCH /finance/entries/:id: integridade do fato financeiro', () => {
    /** Cria um lancamento e o leva ao status pedido. */
    async function lancamentoEm(status: FinancialEntryStatus): Promise<FinancialEntryResponseDto> {
      const criado = await criar();
      if (status === FinancialEntryStatus.Pendente) {
        return criado;
      }
      if (status === FinancialEntryStatus.Cancelado) {
        await mudarStatus(criado.id, FinancialEntryStatus.Pago);
      }
      const response = await request(server())
        .patch(`/finance/entries/${criado.id}/status`)
        .set('Authorization', bearer(adminToken))
        .send({ status })
        .expect(200);
      return response.body as FinancialEntryResponseDto;
    }

    async function mudarStatus(id: string, status: FinancialEntryStatus): Promise<void> {
      await request(server())
        .patch(`/finance/entries/${id}/status`)
        .set('Authorization', bearer(adminToken))
        .send({ status })
        .expect(200);
    }

    async function editar(id: string, body: object, esperado: number): Promise<void> {
      await request(server())
        .patch(`/finance/entries/${id}`)
        .set('Authorization', bearer(adminToken))
        .send(body)
        .expect(esperado);
    }

    /** Estado atual direto da API, para conferir que nada mudou. */
    async function buscar(id: string): Promise<FinancialEntryResponseDto> {
      const response = await request(server())
        .get(`/finance/entries/${id}`)
        .set('Authorization', bearer(adminToken))
        .expect(200);
      return response.body as FinancialEntryResponseDto;
    }

    it('PENDENTE permite alterar valor e data', async () => {
      const criado = await lancamentoEm(FinancialEntryStatus.Pendente);

      await editar(criado.id, { valor: 77.77, data: '2030-05-05' }, 200);

      const atual = await buscar(criado.id);
      expect(atual.valor).toBe(77.77);
      expect(atual.data).toBe('2030-05-05');
    });

    describe('PAGO', () => {
      it.each([
        ['valor', { valor: 99.99 }],
        ['data', { data: '2030-01-01' }],
        ['tipo', { tipo: FinancialEntryType.Receita }],
        ['valor e data juntos', { valor: 1, data: '2030-01-01' }],
        ['valor junto de campo permitido', { descricao: 'Nova', valor: 1 }],
        ['tipo junto de campo permitido', { descricao: 'Nova', tipo: FinancialEntryType.Receita }],
      ])('recusa alterar %s com 409 e nao altera o banco', async (_nome, alteracao) => {
        const pago = await lancamentoEm(FinancialEntryStatus.Pago);

        await editar(pago.id, alteracao, 409);

        const atual = await buscar(pago.id);
        expect(atual.valor).toBe(pago.valor);
        expect(atual.data).toBe(pago.data);
        expect(atual.tipo).toBe(pago.tipo);
        expect(atual.descricao).toBe(pago.descricao);
      });

      it('permite corrigir campos descritivos', async () => {
        const pago = await lancamentoEm(FinancialEntryStatus.Pago);

        await editar(
          pago.id,
          { descricao: 'Texto corrigido', categoria: 'Outra', observacao: 'NF 123' },
          200,
        );

        const atual = await buscar(pago.id);
        expect(atual.descricao).toBe('Texto corrigido');
        expect(atual.categoria).toBe('Outra');
        expect(atual.observacao).toBe('NF 123');
        expect(atual.valor).toBe(pago.valor);
        expect(atual.status).toBe(FinancialEntryStatus.Pago);
      });

      it.each([
        ['valor', { valor: 99.99 }],
        ['tipo', { tipo: FinancialEntryType.Receita }],
      ])(
        'a recusa de %s nao gera registro de auditoria de atualizacao',
        async (_nome, alteracao) => {
          const pago = await lancamentoEm(FinancialEntryStatus.Pago);

          await editar(pago.id, alteracao, 409);

          const response = await request(server())
            .get('/audit-logs?limit=100')
            .set('Authorization', bearer(adminToken))
            .expect(200);
          const doAlvo = (response.body as AuditLogPageResponseDto).items.filter(
            (log) => log.metadados?.alvoId === pago.id,
          );

          expect(doAlvo.map((log) => log.acao)).not.toContain('FINANCE_ENTRY_UPDATED');
        },
      );
    });

    describe('CANCELADO', () => {
      it.each([
        ['valor', { valor: 99.99 }],
        ['data', { data: '2030-01-01' }],
        ['descricao', { descricao: 'Outra' }],
        ['categoria', { categoria: 'Outra' }],
        ['observacao', { observacao: 'Outra' }],
        ['tipo', { tipo: FinancialEntryType.Receita }],
      ])('recusa alterar %s com 409: o registro esta encerrado', async (_nome, alteracao) => {
        const cancelado = await lancamentoEm(FinancialEntryStatus.Cancelado);

        await editar(cancelado.id, alteracao, 409);

        const atual = await buscar(cancelado.id);
        expect(atual).toMatchObject({
          valor: cancelado.valor,
          data: cancelado.data,
          descricao: cancelado.descricao,
          categoria: cancelado.categoria,
          tipo: cancelado.tipo,
          status: FinancialEntryStatus.Cancelado,
        });
      });

      it('corpo vazio continua respondendo 200, sem efeito', async () => {
        const cancelado = await lancamentoEm(FinancialEntryStatus.Cancelado);

        await editar(cancelado.id, {}, 200);
      });
    });
  });

  describe('PATCH /finance/entries/:id/status', () => {
    async function mudarStatus(
      id: string,
      status: FinancialEntryStatus,
      esperado: number,
    ): Promise<FinancialEntryResponseDto> {
      const response = await request(server())
        .patch(`/finance/entries/${id}/status`)
        .set('Authorization', bearer(adminToken))
        .send({ status })
        .expect(esperado);
      return response.body as FinancialEntryResponseDto;
    }

    it('PENDENTE -> PAGO', async () => {
      const criado = await criar();
      const atualizado = await mudarStatus(criado.id, FinancialEntryStatus.Pago, 200);

      expect(atualizado.status).toBe(FinancialEntryStatus.Pago);
    });

    it('PENDENTE -> CANCELADO', async () => {
      const criado = await criar();
      const atualizado = await mudarStatus(criado.id, FinancialEntryStatus.Cancelado, 200);

      expect(atualizado.status).toBe(FinancialEntryStatus.Cancelado);
    });

    it('PAGO -> CANCELADO', async () => {
      const criado = await criar();
      await mudarStatus(criado.id, FinancialEntryStatus.Pago, 200);
      const atualizado = await mudarStatus(criado.id, FinancialEntryStatus.Cancelado, 200);

      expect(atualizado.status).toBe(FinancialEntryStatus.Cancelado);
    });

    it('PAGO -> PENDENTE e recusado com 409', async () => {
      const criado = await criar();
      await mudarStatus(criado.id, FinancialEntryStatus.Pago, 200);

      await mudarStatus(criado.id, FinancialEntryStatus.Pendente, 409);
    });

    it('CANCELADO e terminal: qualquer transicao responde 409', async () => {
      const criado = await criar();
      await mudarStatus(criado.id, FinancialEntryStatus.Cancelado, 200);

      await mudarStatus(criado.id, FinancialEntryStatus.Pago, 409);
      await mudarStatus(criado.id, FinancialEntryStatus.Pendente, 409);
    });

    it('repetir o status atual responde 200 sem alterar nada', async () => {
      const criado = await criar();
      const atualizado = await mudarStatus(criado.id, FinancialEntryStatus.Pendente, 200);

      expect(atualizado.status).toBe(FinancialEntryStatus.Pendente);
      expect(atualizado.updatedAt).toEqual(criado.updatedAt);
    });

    it('status invalido responde 400', async () => {
      const criado = await criar();

      await request(server())
        .patch(`/finance/entries/${criado.id}/status`)
        .set('Authorization', bearer(adminToken))
        .send({ status: 'ARQUIVADO' })
        .expect(400);
    });

    it('lancamento inexistente responde 404', async () => {
      await mudarStatus('3f2504e0-4f89-11d3-9a0c-0305e82c3301', FinancialEntryStatus.Pago, 404);
    });
  });

  describe('auditoria', () => {
    async function auditoriaDe(alvoId: string): Promise<AuditLogPageResponseDto['items']> {
      const response = await request(server())
        .get('/audit-logs?limit=100')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      return (response.body as AuditLogPageResponseDto).items.filter(
        (log) => log.metadados?.alvoId === alvoId,
      );
    }

    it('registra criacao, edicao e mudanca de status', async () => {
      const criado = await criar();
      await request(server())
        .patch(`/finance/entries/${criado.id}`)
        .set('Authorization', bearer(adminToken))
        .send({ descricao: 'Auditada' })
        .expect(200);
      await request(server())
        .patch(`/finance/entries/${criado.id}/status`)
        .set('Authorization', bearer(adminToken))
        .send({ status: FinancialEntryStatus.Pago })
        .expect(200);

      const registros = await auditoriaDe(criado.id);

      expect(registros.map((log) => log.acao).sort()).toEqual([
        'FINANCE_ENTRY_CREATED',
        'FINANCE_ENTRY_STATUS_CHANGED',
        'FINANCE_ENTRY_UPDATED',
      ]);
      for (const log of registros) {
        expect(log.modulo).toBe('FINANCE');
        expect(log.usuario?.email).toBe(ADMIN.email);
      }
    });

    it('nao grava valor nem descricao do lancamento na trilha', async () => {
      const criado = await criar(adminToken, {
        ...NOVO_LANCAMENTO,
        descricao: 'Segredo comercial',
        valor: 987654.32,
      });

      const registros = await auditoriaDe(criado.id);
      const texto = JSON.stringify(registros.map((log) => log.metadados));

      expect(texto).not.toContain('Segredo comercial');
      expect(texto).not.toContain('987654');
    });

    it('consultar a lista nao gera registro de auditoria', async () => {
      const antes = await request(server())
        .get('/audit-logs?limit=1')
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const totalAntes = (antes.body as AuditLogPageResponseDto).total;

      await request(server())
        .get('/finance/entries')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const depois = await request(server())
        .get('/audit-logs?limit=1')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      expect((depois.body as AuditLogPageResponseDto).total).toBe(totalAntes);
    });
  });

  describe('comando /financeiro', () => {
    it('usuario com finance:read recebe o resumo com dados reais', async () => {
      await criar(adminToken, { ...NOVO_LANCAMENTO, descricao: 'Lancamento do comando' });

      const resultado = await executarComando(adminToken, '/financeiro');

      expect(resultado.success).toBe(true);
      expect(resultado.outcome).toBe('OK');
      expect(resultado.reply).toContain('Lancamentos registrados:');
      expect(resultado.reply).toContain('Mais recentes');
    });

    it('usuario sem finance:read recebe recusa do motor', async () => {
      const resultado = await executarComando(semPermissaoToken, '/financeiro');

      expect(resultado.success).toBe(false);
      expect(resultado.outcome).toBe('PERMISSION_DENIED');
      expect(resultado.reply).not.toContain('Lancamentos registrados');
    });

    it('GESTOR tambem executa, pela permissao do seeder', async () => {
      const resultado = await executarComando(gestorToken, '/financeiro');

      expect(resultado.success).toBe(true);
    });

    it('sem JWT responde 401', async () => {
      await request(server()).post('/commands/execute').send({ text: '/financeiro' }).expect(401);
    });

    it('a execucao NAO gera registro de auditoria', async () => {
      const totalDeEventos = async (): Promise<number> => {
        const response = await request(server())
          .get('/audit-logs?limit=1')
          .set('Authorization', bearer(adminToken))
          .expect(200);
        return (response.body as AuditLogPageResponseDto).total;
      };

      const antes = await totalDeEventos();
      await executarComando(adminToken, '/financeiro');
      await executarComando(adminToken, '/financeiro');

      expect(await totalDeEventos()).toBe(antes);
    });

    it('aparece em /ajuda para quem pode executa-lo', async () => {
      const resultado = await executarComando(adminToken, '/ajuda');

      expect(resultado.reply).toContain('financeiro');
    });
  });
});
