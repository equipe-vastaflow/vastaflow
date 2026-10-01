import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import { AuditAction } from '../src/modules/audit/audit-action.enum';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { FinanceReportSummaryDto } from '../src/modules/finance/dto/finance-report-response.dto';
import type { FinancialEntryPageResponseDto } from '../src/modules/finance/dto/financial-entry-page-response.dto';
import type { FinancialEntryResponseDto } from '../src/modules/finance/dto/financial-entry-response.dto';
import { EXPORT_MAX_ROWS } from '../src/modules/finance/finance-reports.service';
import {
  FinancialEntryStatus,
  FinancialEntryType,
} from '../src/modules/finance/financial-entry.enums';
import { MAX_REPORT_PERIOD_DAYS } from '../src/modules/finance/report-period.policy';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Conjunto fixo que torna os totais conferiveis a mao.
 *
 * Receitas nao canceladas: 1000 + 250.50 = 1250.50
 * Despesas nao canceladas: 400.25 + 99.75 = 500.00
 * Saldo: 750.50
 * A RECEITA de 7000 e CANCELADA: conta em totalRegistros e em porStatus, mas
 * fica fora do saldo. O lancamento de dezembro fica fora do periodo de janeiro.
 */
const CONJUNTO = [
  {
    tipo: FinancialEntryType.Receita,
    descricao: 'Venda de soja',
    valor: 1000,
    data: '2026-01-05',
    categoria: 'Vendas',
  },
  {
    tipo: FinancialEntryType.Receita,
    descricao: 'Venda de milho',
    valor: 250.5,
    data: '2026-01-20',
    categoria: 'Vendas',
  },
  {
    tipo: FinancialEntryType.Despesa,
    descricao: 'Compra de insumos',
    valor: 400.25,
    data: '2026-01-10',
    categoria: 'Insumos',
  },
  {
    tipo: FinancialEntryType.Despesa,
    descricao: 'Combustivel',
    valor: 99.75,
    data: '2026-01-31',
    categoria: 'Logistica',
  },
  {
    tipo: FinancialEntryType.Receita,
    descricao: 'Venda desfeita',
    valor: 7000,
    data: '2026-01-15',
    categoria: 'Vendas',
  },
  {
    tipo: FinancialEntryType.Despesa,
    descricao: 'Fora do periodo',
    valor: 5555,
    data: '2026-12-01',
    categoria: 'Insumos',
  },
];

const JANEIRO = { de: '2026-01-01', ate: '2026-01-31' };

/**
 * Abre a planilha baixada.
 *
 * `load` recebe um `ArrayBuffer`, e nao um `Buffer` do Node: o `index.d.ts` do
 * exceljs declara `interface Buffer extends ArrayBuffer`, e o comentario da
 * propria assinatura diz que a carga vem de um array buffer.
 */
async function abrirPlanilha(corpo: unknown): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(paraArrayBuffer(corpo as Buffer));
  return workbook;
}

/** Copia os bytes para um `ArrayBuffer` do tamanho exato. */
function paraArrayBuffer(bytes: Buffer): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('Relatorios do financeiro (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let adminToken: string;
  /** GESTOR: tem `finance:read` pelo seeder. */
  let gestorToken: string;
  /** USUARIO: nenhuma permissao financeira. */
  let semPermissaoToken: string;
  let counter = 0;
  /** O lancamento que foi CANCELADO, para conferir o que entra no saldo. */
  let cancelado: FinancialEntryResponseDto;

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

  async function criar(body: object): Promise<FinancialEntryResponseDto> {
    const response = await request(server())
      .post('/finance/entries')
      .set('Authorization', bearer(adminToken))
      .send(body)
      .expect(201);
    return response.body as FinancialEntryResponseDto;
  }

  async function resumo(
    query: Record<string, string>,
    token = adminToken,
  ): Promise<FinanceReportSummaryDto> {
    const response = await request(server())
      .get('/finance/reports/summary')
      .query(query)
      .set('Authorization', bearer(token))
      .expect(200);
    return response.body as FinanceReportSummaryDto;
  }

  /** Baixa a planilha e devolve a resposta crua, com o corpo em Buffer. */
  async function exportar(
    query: Record<string, string>,
    token = adminToken,
  ): Promise<request.Response> {
    return request(server())
      .get('/finance/reports/export')
      .query(query)
      .set('Authorization', bearer(token))
      .buffer(true)
      .parse((res, callback) => {
        const pedacos: Buffer[] = [];
        res.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
        res.on('end', () => callback(null, Buffer.concat(pedacos)));
      });
  }

  async function planilha(query: Record<string, string>): Promise<Workbook> {
    const response = await exportar(query);
    expect(response.status).toBe(200);
    return abrirPlanilha(response.body);
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
    gestorToken = await tokenFor(RoleName.Gestor);
    semPermissaoToken = await tokenFor(RoleName.Usuario);

    const criados: FinancialEntryResponseDto[] = [];
    for (const lancamento of CONJUNTO) {
      criados.push(await criar(lancamento));
    }

    // Um PAGO e um CANCELADO, para que os agrupamentos tenham os tres status.
    await request(server())
      .patch(`/finance/entries/${criados[0].id}/status`)
      .set('Authorization', bearer(adminToken))
      .send({ status: FinancialEntryStatus.Pago })
      .expect(200);

    cancelado = criados[4];
    await request(server())
      .patch(`/finance/entries/${cancelado.id}/status`)
      .set('Authorization', bearer(adminToken))
      .send({ status: FinancialEntryStatus.Cancelado })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('autorizacao', () => {
    it.each(['/finance/reports/summary', '/finance/reports/export'])(
      'sem token: 401 em %s',
      async (rota) => {
        await request(server()).get(rota).query(JANEIRO).expect(401);
      },
    );

    it.each(['/finance/reports/summary', '/finance/reports/export'])(
      'sem finance:read: 403 em %s',
      async (rota) => {
        await request(server())
          .get(rota)
          .query(JANEIRO)
          .set('Authorization', bearer(semPermissaoToken))
          .expect(403);
      },
    );

    it('GESTOR com finance:read acessa o resumo', async () => {
      const dados = await resumo(JANEIRO, gestorToken);

      expect(dados.totalRegistros).toBe(5);
    });

    it('GESTOR com finance:read exporta a planilha', async () => {
      const response = await exportar(JANEIRO, gestorToken);

      // `finance:read` e suficiente de proposito: e o mesmo conjunto que a
      // listagem ja entrega pagina por pagina.
      expect(response.status).toBe(200);
    });
  });

  describe('GET /finance/reports/summary', () => {
    it('soma receitas e despesas do periodo e devolve o saldo', async () => {
      const dados = await resumo(JANEIRO);

      expect(dados.totalReceitas).toBe(1250.5);
      expect(dados.totalDespesas).toBe(500);
      expect(dados.saldo).toBe(750.5);
    });

    it('conta os CANCELADOS em totalRegistros', async () => {
      const dados = await resumo(JANEIRO);

      // Cinco lancamentos em janeiro, incluindo o cancelado; o de dezembro fica
      // fora do periodo.
      expect(dados.totalRegistros).toBe(5);
    });

    it('deixa o CANCELADO fora do saldo mas dentro de porStatus', async () => {
      const dados = await resumo(JANEIRO);

      const canceladoNoGrupo = dados.porStatus.find(
        (linha) => linha.status === FinancialEntryStatus.Cancelado,
      );
      expect(canceladoNoGrupo).toEqual({
        status: FinancialEntryStatus.Cancelado,
        quantidade: 1,
        valor: 7000,
      });
      // A receita cancelada de 7000 nao aparece em totalReceitas.
      expect(dados.totalReceitas).toBe(1250.5);
    });

    it('agrupa por status, somando os tres estados', async () => {
      const dados = await resumo(JANEIRO);

      expect(dados.porStatus).toEqual([
        { status: FinancialEntryStatus.Cancelado, quantidade: 1, valor: 7000 },
        { status: FinancialEntryStatus.Pago, quantidade: 1, valor: 1000 },
        { status: FinancialEntryStatus.Pendente, quantidade: 3, valor: 750.5 },
      ]);
    });

    it('agrupa por tipo', async () => {
      const dados = await resumo(JANEIRO);

      expect(dados.porTipo).toEqual([
        { tipo: FinancialEntryType.Despesa, quantidade: 2, valor: 500 },
        { tipo: FinancialEntryType.Receita, quantidade: 3, valor: 8250.5 },
      ]);
    });

    it('agrupa por categoria', async () => {
      const dados = await resumo(JANEIRO);

      expect(dados.porCategoria).toEqual([
        { categoria: 'Insumos', quantidade: 1, valor: 400.25 },
        { categoria: 'Logistica', quantidade: 1, valor: 99.75 },
        { categoria: 'Vendas', quantidade: 3, valor: 8250.5 },
      ]);
    });

    it('o periodo recorta de verdade: dezembro fica fora de janeiro', async () => {
      const dezembro = await resumo({ de: '2026-12-01', ate: '2026-12-31' });

      expect(dezembro.totalRegistros).toBe(1);
      expect(dezembro.totalDespesas).toBe(5555);
    });

    it('o periodo e inclusivo nas duas pontas', async () => {
      // 05/01 e 31/01 sao exatamente as datas de dois lancamentos.
      const pontas = await resumo({ de: '2026-01-05', ate: '2026-01-31' });
      const dentro = await resumo({ de: '2026-01-06', ate: '2026-01-30' });

      expect(pontas.totalRegistros).toBe(5);
      expect(dentro.totalRegistros).toBe(3);
    });

    it('filtra por status', async () => {
      const dados = await resumo({ ...JANEIRO, status: FinancialEntryStatus.Pendente });

      expect(dados.totalRegistros).toBe(3);
      expect(dados.porStatus).toEqual([
        { status: FinancialEntryStatus.Pendente, quantidade: 3, valor: 750.5 },
      ]);
    });

    it('filtra por tipo', async () => {
      const dados = await resumo({ ...JANEIRO, tipo: FinancialEntryType.Despesa });

      expect(dados.totalReceitas).toBe(0);
      expect(dados.totalDespesas).toBe(500);
      expect(dados.saldo).toBe(-500);
    });

    it('filtra por categoria', async () => {
      const dados = await resumo({ ...JANEIRO, categoria: 'Logistica' });

      expect(dados.totalRegistros).toBe(1);
      expect(dados.totalDespesas).toBe(99.75);
    });

    it('combina varios filtros', async () => {
      const dados = await resumo({
        ...JANEIRO,
        tipo: FinancialEntryType.Receita,
        status: FinancialEntryStatus.Cancelado,
      });

      expect(dados.totalRegistros).toBe(1);
      // Cancelado nao soma em receitas, mesmo sendo o unico do recorte.
      expect(dados.totalReceitas).toBe(0);
      expect(dados.saldo).toBe(0);
    });

    it('recorte sem nenhum lancamento devolve zeros, nao erro', async () => {
      const dados = await resumo({ de: '2030-01-01', ate: '2030-01-31' });

      expect(dados).toMatchObject({
        totalRegistros: 0,
        totalReceitas: 0,
        totalDespesas: 0,
        saldo: 0,
        porStatus: [],
        porTipo: [],
        porCategoria: [],
      });
    });

    it('devolve o recorte aplicado, com os ausentes como null', async () => {
      const dados = await resumo({ ...JANEIRO, tipo: FinancialEntryType.Receita });

      expect(dados.filtros).toEqual({
        de: '2026-01-01',
        ate: '2026-01-31',
        status: null,
        tipo: FinancialEntryType.Receita,
        categoria: null,
      });
    });

    it('nao devolve um valorTotal somando receitas com despesas', async () => {
      const dados = await resumo(JANEIRO);

      expect(dados).not.toHaveProperty('valorTotal');
    });

    it('todo numero vem como number, nunca string', async () => {
      // O MySQL devolve SUM/COUNT como string; a API nao pode mudar de tipo
      // conforme o banco.
      const dados = await resumo(JANEIRO);

      for (const campo of ['totalRegistros', 'totalReceitas', 'totalDespesas', 'saldo'] as const) {
        expect(typeof dados[campo]).toBe('number');
      }
      for (const linha of [...dados.porStatus, ...dados.porTipo, ...dados.porCategoria]) {
        expect(typeof linha.quantidade).toBe('number');
        expect(typeof linha.valor).toBe('number');
      }
    });

    describe('validacao do periodo', () => {
      it.each([
        ['de ausente', { ate: '2026-01-31' }],
        ['ate ausente', { de: '2026-01-01' }],
        ['periodo ausente', {}],
      ])('%s: 400', async (_caso, query) => {
        await request(server())
          .get('/finance/reports/summary')
          .query(query)
          .set('Authorization', bearer(adminToken))
          .expect(400);
      });

      it.each([
        ['formato com hora', { de: '2026-01-01T00:00:00Z', ate: '2026-01-31' }],
        ['formato brasileiro', { de: '01/01/2026', ate: '31/01/2026' }],
        ['data inexistente', { de: '2026-01-01', ate: '2026-02-30' }],
        ['29 de fevereiro em ano comum', { de: '2026-01-01', ate: '2026-02-29' }],
      ])('%s: 400', async (_caso, query) => {
        await request(server())
          .get('/finance/reports/summary')
          .query(query)
          .set('Authorization', bearer(adminToken))
          .expect(400);
      });

      it('ate anterior a de: 400 com mensagem clara', async () => {
        const response = await request(server())
          .get('/finance/reports/summary')
          .query({ de: '2026-02-01', ate: '2026-01-01' })
          .set('Authorization', bearer(adminToken))
          .expect(400);

        expect(String((response.body as { message: unknown }).message)).toContain(
          'ate nao pode ser anterior a de',
        );
      });

      it('periodo acima de um ano: 400 com mensagem clara', async () => {
        const response = await request(server())
          .get('/finance/reports/summary')
          .query({ de: '2024-01-01', ate: '2026-12-31' })
          .set('Authorization', bearer(adminToken))
          .expect(400);

        expect(String((response.body as { message: unknown }).message)).toContain(
          String(MAX_REPORT_PERIOD_DAYS),
        );
      });

      it('um ano inteiro e aceito', async () => {
        await request(server())
          .get('/finance/reports/summary')
          .query({ de: '2026-01-01', ate: '2026-12-31' })
          .set('Authorization', bearer(adminToken))
          .expect(200);
      });

      it('status fora do enum: 400', async () => {
        await request(server())
          .get('/finance/reports/summary')
          .query({ ...JANEIRO, status: 'QUITADO' })
          .set('Authorization', bearer(adminToken))
          .expect(400);
      });

      it('parametro desconhecido: 400', async () => {
        await request(server())
          .get('/finance/reports/summary')
          .query({ ...JANEIRO, criadoPorId: 'qualquer' })
          .set('Authorization', bearer(adminToken))
          .expect(400);
      });
    });

    it('consultar o resumo nao gera registro de auditoria', async () => {
      const antes = await contarAuditoria(AuditAction.FinanceReportExported);

      await resumo(JANEIRO);

      expect(await contarAuditoria(AuditAction.FinanceReportExported)).toBe(antes);
    });
  });

  describe('GET /finance/reports/export', () => {
    it('responde com o tipo e o nome de arquivo de uma planilha', async () => {
      const response = await exportar(JANEIRO);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain(XLSX_CONTENT_TYPE);
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="vastaflow-financeiro-2026-01-01-a-2026-01-31.xlsx"',
      );
    });

    it('a planilha tem cabecalho e uma linha por lancamento do recorte', async () => {
      const workbook = await planilha(JANEIRO);
      const sheet = workbook.getWorksheet('Lancamentos');

      expect(sheet).toBeDefined();
      expect(sheet?.rowCount).toBe(6); // cabecalho + 5 de janeiro
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        'ID',
        'Tipo',
        'Descricao',
        'Valor',
        'Data',
        'Categoria',
        'Status',
        'Observacao',
      ]);
    });

    it('exporta as LINHAS do recorte, nao o resumo', async () => {
      const workbook = await planilha(JANEIRO);
      const sheet = workbook.getWorksheet('Lancamentos');

      const descricoes: unknown[] = [];
      sheet?.eachRow((row, numero) => {
        if (numero > 1) {
          descricoes.push(row.getCell(3).value);
        }
      });
      expect(descricoes).toHaveLength(5);
      expect(descricoes).toContain('Venda de soja');
      expect(descricoes).toContain('Combustivel');
      expect(descricoes).not.toContain('Fora do periodo');
    });

    it('o valor vai como numero com duas casas, somavel no Excel', async () => {
      const workbook = await planilha(JANEIRO);
      const sheet = workbook.getWorksheet('Lancamentos');

      const valores: unknown[] = [];
      sheet?.eachRow((row, numero) => {
        if (numero > 1) {
          valores.push(row.getCell(4).value);
        }
      });
      for (const valor of valores) {
        expect(typeof valor).toBe('number');
      }
      expect(valores).toContain(400.25);
      expect(valores).toContain(99.75);
    });

    it('a data sai como o mesmo dia do banco, em meia-noite UTC', async () => {
      const workbook = await planilha({ de: '2026-01-31', ate: '2026-01-31' });
      const celula = workbook.getWorksheet('Lancamentos')?.getRow(2).getCell(5).value;

      expect(celula).toBeInstanceOf(Date);
      expect((celula as Date).toISOString()).toBe('2026-01-31T00:00:00.000Z');
    });

    it('respeita os filtros, iguais aos do resumo', async () => {
      const workbook = await planilha({ ...JANEIRO, categoria: 'Logistica' });

      expect(workbook.getWorksheet('Lancamentos')?.rowCount).toBe(2); // cabecalho + 1
    });

    it('recorte vazio exporta planilha so com cabecalho, e nao erro', async () => {
      const workbook = await planilha({ de: '2030-01-01', ate: '2030-01-31' });

      expect(workbook.getWorksheet('Lancamentos')?.rowCount).toBe(1);
    });

    it('nao expoe o id de quem criou o lancamento', async () => {
      const response = await exportar(JANEIRO);
      const workbook = await abrirPlanilha(response.body);
      const sheet = workbook.getWorksheet('Lancamentos');

      // `criado_por_id` e identificacao interna e nao diz nada a quem le a
      // planilha; resolver o nome exigiria consulta por linha.
      expect(sheet?.getRow(1).values).not.toContain('Criado por');
      expect(sheet?.columnCount).toBe(8);
    });

    it.each([
      ['de ausente', { ate: '2026-01-31' }],
      ['ate anterior a de', { de: '2026-02-01', ate: '2026-01-01' }],
      ['periodo acima de um ano', { de: '2024-01-01', ate: '2026-12-31' }],
    ])('%s: 400 em JSON, sem planilha', async (_caso, query) => {
      const response = await exportar(query);

      expect(response.status).toBe(400);
      // O erro NAO pode sair com cabecalho de download: o cliente receberia um
      // arquivo corrompido em vez da mensagem.
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toBeUndefined();
    });

    it('o limite de linhas e o esperado', () => {
      // Gerar 50.001 lancamentos num e2e custaria minutos; o comportamento no
      // limite esta coberto no teste de unidade do service, que injeta a
      // contagem. Aqui fica apenas o contrato do numero.
      expect(EXPORT_MAX_ROWS).toBe(50_000);
    });

    describe('auditoria', () => {
      it('registra FINANCE_REPORT_EXPORTED com o recorte e a quantidade', async () => {
        const antes = await idsDeAuditoria(AuditAction.FinanceReportExported);

        await exportar({ ...JANEIRO, tipo: FinancialEntryType.Despesa });

        // Identifica o registro novo pelo id, e nao pela posicao na lista:
        // varias exportacoes deste arquivo caem no mesmo instante e o desempate
        // entre elas e um UUID, portanto a ordem nao e previsivel.
        const novos = (await buscarAuditoria(AuditAction.FinanceReportExported)).filter(
          (item) => !antes.has(item.id),
        );
        expect(novos).toHaveLength(1);

        expect(novos[0].modulo).toBe('FINANCE');
        expect(novos[0].metadados).toEqual({
          de: '2026-01-01',
          ate: '2026-01-31',
          status: null,
          tipo: FinancialEntryType.Despesa,
          categoria: null,
          quantidade: 2,
        });
      });

      it('nao registra valor monetario nem descricao de lancamento', async () => {
        await exportar(JANEIRO);

        // Vale para TODO registro de exportacao, nao apenas para o ultimo.
        const registros = await buscarAuditoria(AuditAction.FinanceReportExported);
        expect(registros.length).toBeGreaterThan(0);

        for (const registro of registros) {
          const serializado = JSON.stringify({
            descricao: registro.descricao,
            metadados: registro.metadados,
          });

          expect(serializado).not.toContain('Venda de soja');
          expect(serializado).not.toContain('1250.5');
          expect(serializado).not.toContain('7000');
        }
      });

      it('uma exportacao recusada nao gera registro', async () => {
        const antes = await contarAuditoria(AuditAction.FinanceReportExported);

        await exportar({ de: '2026-02-01', ate: '2026-01-01' });

        expect(await contarAuditoria(AuditAction.FinanceReportExported)).toBe(antes);
      });
    });
  });

  describe('filtros na listagem de lancamentos', () => {
    async function listar(query: Record<string, string>): Promise<FinancialEntryPageResponseDto> {
      const response = await request(server())
        .get('/finance/entries')
        .query(query)
        .set('Authorization', bearer(adminToken))
        .expect(200);
      return response.body as FinancialEntryPageResponseDto;
    }

    it('sem filtro nenhum, lista tudo', async () => {
      const pagina = await listar({});

      expect(pagina.total).toBe(CONJUNTO.length);
    });

    it('filtra por periodo', async () => {
      const pagina = await listar(JANEIRO);

      expect(pagina.total).toBe(5);
      expect(pagina.items).toHaveLength(5);
    });

    it('o total refere-se ao conjunto FILTRADO, nao a tabela', async () => {
      const pagina = await listar({ ...JANEIRO, categoria: 'Vendas' });

      // Se o filtro fosse aplicado em memoria depois da paginacao, `total`
      // continuaria sendo o da tabela e a paginacao nao fecharia.
      expect(pagina.total).toBe(3);
    });

    it('o filtro vale para as paginas seguintes', async () => {
      const primeira = await listar({ ...JANEIRO, page: '1', limit: '2' });
      const terceira = await listar({ ...JANEIRO, page: '3', limit: '2' });

      expect(primeira.total).toBe(5);
      expect(primeira.items).toHaveLength(2);
      expect(terceira.items).toHaveLength(1);
      const ids = [...primeira.items, ...terceira.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('filtra por status, tipo e categoria', async () => {
      expect((await listar({ status: FinancialEntryStatus.Cancelado })).total).toBe(1);
      expect((await listar({ tipo: FinancialEntryType.Receita })).total).toBe(3);
      expect((await listar({ categoria: 'Insumos' })).total).toBe(2);
    });

    it('combina filtro com paginacao sem perder nenhum dos dois', async () => {
      const pagina = await listar({ tipo: FinancialEntryType.Despesa, page: '1', limit: '1' });

      expect(pagina.total).toBe(3);
      expect(pagina.items).toHaveLength(1);
      expect(pagina.limit).toBe(1);
    });

    it('listagem e relatorio concordam no mesmo recorte', async () => {
      const pagina = await listar({ ...JANEIRO, tipo: FinancialEntryType.Receita });
      const dados = await resumo({ ...JANEIRO, tipo: FinancialEntryType.Receita });

      // Os dois caminhos usam o mesmo filtro e o mesmo repositorio: divergir aqui
      // significaria dois dialetos de filtro.
      expect(pagina.total).toBe(dados.totalRegistros);
    });

    it('data invalida na listagem: 400', async () => {
      await request(server())
        .get('/finance/entries')
        .query({ de: '2026-02-30' })
        .set('Authorization', bearer(adminToken))
        .expect(400);
    });

    it('o lancamento cancelado continua aparecendo na listagem', async () => {
      const pagina = await listar({ status: FinancialEntryStatus.Cancelado });

      expect(pagina.items[0].id).toBe(cancelado.id);
    });
  });

  async function buscarAuditoria(acao: AuditAction): Promise<AuditLogPageResponseDto['items']> {
    const response = await request(server())
      .get('/audit-logs')
      .query({ limit: '100' })
      .set('Authorization', bearer(adminToken))
      .expect(200);
    const pagina = response.body as AuditLogPageResponseDto;
    // `acao` chega da API como texto; comparar direto com o enum e recusado pelo
    // lint justamente porque sao tipos diferentes.
    const esperada: string = acao;
    return pagina.items.filter((item) => item.acao === esperada);
  }

  async function contarAuditoria(acao: AuditAction): Promise<number> {
    return (await buscarAuditoria(acao)).length;
  }

  async function idsDeAuditoria(acao: AuditAction): Promise<Set<string>> {
    return new Set((await buscarAuditoria(acao)).map((item) => item.id));
  }
});
