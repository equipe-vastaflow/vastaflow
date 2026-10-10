import './support/plantae-enabled-env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { RoleName } from '../src/modules/roles/role-name.enum';
import {
  addCredential,
  EMPTY_CREDENTIALS_FILE,
} from '../src/modules/service-auth/service-credentials.admin';
import { serializeCredentialsFile } from '../src/modules/service-auth/service-credentials.file';
import { PlantaeHttpClient } from '../src/modules/integrations/plantae/plantae-http.client';
import { PlantaeRateLimiter } from '../src/modules/integrations/plantae/plantae-rate-limiter';
import { UsersService } from '../src/modules/users/users.service';
import {
  accountJson,
  BASE_URL,
  entryJson,
  FAKE_TOKEN,
  invoiceJson,
  jsonResponse,
  legalEntityJson,
  listJson,
  ME_JSON,
  movementJson,
  personJson,
} from './support/plantae-fixtures';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const BASE = '/integrations/plantae';
const PERIODO = 'data_inicio=2026-09-01&data_fim=2026-09-30';

/** As 9 rotas, com a query minima valida de cada uma. */
const ROTAS: Array<[string, string, string]> = [
  ['status', `${BASE}/status`, ''],
  ['me', `${BASE}/me`, '/me'],
  ['entries', `${BASE}/financial/entries?${PERIODO}`, '/financial/entries'],
  ['accounts', `${BASE}/financial/accounts`, '/financial/accounts'],
  ['movements', `${BASE}/financial/movements?${PERIODO}`, '/financial/movements'],
  [
    'account-statement',
    `${BASE}/financial/account-statement?${PERIODO}&conta_id=11`,
    '/financial/account-statement',
  ],
  ['issued-invoices', `${BASE}/fiscal/issued-invoices?${PERIODO}`, '/fiscal/issued-invoices'],
  ['legal-entities', `${BASE}/organization/legal-entities`, '/organization/legal-entities'],
  ['people', `${BASE}/people`, '/people'],
];

/** Corpo que o Plantae devolveria para cada endpoint. */
function corpoPara(upstreamPath: string): string {
  switch (upstreamPath) {
    case '/me':
      return ME_JSON;
    case '/financial/entries':
      return listJson([entryJson(482), entryJson(483)], { nextCursor: 'cur2' });
    case '/financial/accounts':
      return listJson([accountJson()], { endpoint: 'financial/accounts' });
    case '/financial/movements':
      return listJson([movementJson()], { endpoint: 'financial/movements' });
    case '/financial/account-statement':
      return listJson([movementJson()], {
        withLinks: false,
        endpoint: 'financial/account-statement',
        metaExtra: '"saldo_anterior":2605.14,"saldo_final":3470.10',
      });
    case '/fiscal/issued-invoices':
      return listJson([invoiceJson()], { endpoint: 'fiscal/issued-invoices' });
    case '/organization/legal-entities':
      return listJson([legalEntityJson()], { endpoint: 'organization/legal-entities' });
    default:
      return listJson([personJson()], { endpoint: 'people', withLinks: false, withMeta: false });
  }
}

/** URL de um argumento de `fetch`, sem depender de `String(objeto)`. */
function urlDe(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

describe('Plantae (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let adminToken: string;
  let dir: string;
  let n8nToken: string;
  let fetchSpy: jest.SpyInstance<
    Promise<Response>,
    [input: string | URL | Request, init?: RequestInit]
  >;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const como = (token: string, path: string): request.Test =>
    request(server()).get(path).set('Authorization', `Bearer ${token}`);
  const admin = (path: string): request.Test => como(adminToken, path);

  async function tokenDe(role: RoleName): Promise<string> {
    counter += 1;
    const email = `${role.toLowerCase()}${String(counter)}@vasta.test`;
    await usersService.create({ nome: `Teste ${role}`, email, senha: SENHA, role });
    const login = await request(server())
      .post('/auth/login')
      .send({ email, senha: SENHA })
      .expect(200);
    return (login.body as AuthResponseDto).accessToken;
  }

  /** O Plantae simulado responde com `corpoPara(caminho)` e registra o que recebeu. */
  function plantaeResponde(
    fabrica: (upstreamPath: string) => Response | Promise<Response> = (p) =>
      jsonResponse(corpoPara(p)),
  ): void {
    fetchSpy.mockImplementation((input) => {
      const url = new URL(urlDe(input));
      return Promise.resolve(fabrica(url.pathname.replace('/api/v1/external', '')));
    });
  }

  const chamadas = (): Array<{ url: URL; init: RequestInit }> =>
    fetchSpy.mock.calls.map(([input, init]) => ({ url: new URL(urlDe(input)), init: init ?? {} }));

  async function eventosDeAuditoria(): Promise<
    Array<{
      acao: string;
      modulo: string;
      descricao: string;
      metadados: Record<string, unknown> | null;
    }>
  > {
    const response = await admin('/audit-logs?limit=100').expect(200);
    return (response.body as AuditLogPageResponseDto).items.filter(
      (item) => item.acao === 'PLANTAE_QUERIED',
    );
  }

  beforeAll(async () => {
    // Credencial de servico REAL do n8n, para provar que ela nao abre estas rotas.
    dir = mkdtempSync(join(tmpdir(), 'vf-plantae-e2e-'));
    const credenciais = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-e2e',
      principal: 'n8n',
      now: new Date(),
    });
    n8nToken = credenciais.token;
    writeFileSync(join(dir, 'credentials.json'), serializeCredentialsFile(credenciais.file));
    process.env.SERVICE_CREDENTIALS_FILE = join(dir, 'credentials.json');

    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp((builder) =>
      // O limitador local (50/min) e o backoff real sao cobertos nos testes do cliente;
      // aqui eles so deixariam a suite lenta e dependente de relogio.
      builder.overrideProvider(PlantaeHttpClient).useFactory({
        inject: [ConfigService],
        factory: (config: ConfigService): PlantaeHttpClient =>
          new PlantaeHttpClient(config, {
            limiter: new PlantaeRateLimiter({ maxRequests: 10_000, maxConcurrent: 50 }),
            sleep: () => Promise.resolve(),
            random: () => 0,
          }),
      }),
    );
    usersService = app.get(UsersService, { strict: false });
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = (login.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
    delete process.env.SERVICE_CREDENTIALS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchSpy.mockReset();
    plantaeResponde();
  });

  describe('quem pode consultar', () => {
    it.each(ROTAS)('%s: sem autenticacao -> 401, sem chamar o Plantae', async (_nome, path) => {
      await request(server()).get(path).expect(401);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('token invalido -> 401', async () => {
      await como('nao.e.um.jwt', `${BASE}/me`).expect(401);
    });

    it.each([RoleName.Gestor, RoleName.Operador, RoleName.Usuario])(
      '%s -> 403 em TODAS as rotas, sem chamar o Plantae',
      async (role) => {
        const token = await tokenDe(role);

        for (const [, path] of ROTAS) {
          await como(token, path).expect(403);
        }

        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    it('ADMIN -> 200 em todas as rotas', async () => {
      for (const [, path] of ROTAS) {
        await admin(path).expect(200);
      }
    });

    it('so GET: qualquer outro metodo nao existe', async () => {
      for (const metodo of ['post', 'put', 'patch', 'delete'] as const) {
        const response = await request(server())
          [metodo](`${BASE}/me`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(404);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    describe('token de servico do n8n', () => {
      it.each(ROTAS)('%s: X-Service-Token valido -> 401', async (_nome, path) => {
        await request(server()).get(path).set('X-Service-Token', n8nToken).expect(401);

        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('o token de servico tambem nao vale como Bearer', async () => {
        await como(n8nToken, `${BASE}/people`).expect(401);
      });

      it('o escopo do n8n NAO cresceu: continua so `service:identity`', async () => {
        const response = await request(server())
          .get('/service/identity')
          .set('X-Service-Token', n8nToken)
          .expect(200);

        expect((response.body as { scopes: string[] }).scopes).toEqual(['service:identity']);
      });

      it('um JWT humano continua nao abrindo a rota de servico', async () => {
        await como(adminToken, '/service/identity').expect(401);
      });
    });
  });

  describe('status (local)', () => {
    it('READY, em homologacao, sem chamar o Plantae e sem expor URL nem token', async () => {
      const response = await admin(`${BASE}/status`).expect(200);

      expect(response.body).toEqual({
        id: 'plantae',
        name: 'Plantae',
        category: 'OTHER',
        status: 'READY',
        environment: 'homologation',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain(FAKE_TOKEN);
      expect(JSON.stringify(response.body)).not.toContain('plantae.agr.br');
    });
  });

  describe('os 8 endpoints', () => {
    it.each(ROTAS.filter(([nome]) => nome !== 'status'))(
      '%s chama o endpoint certo do Plantae, com GET e Bearer',
      async (_nome, path, upstream) => {
        const response = await admin(path).expect(200);

        const [chamada] = chamadas();
        expect(chamadas()).toHaveLength(1);
        expect(chamada?.url.origin).toBe('https://rc.plantae.agr.br');
        expect(chamada?.url.pathname).toBe(`/api/v1/external${upstream}`);
        expect(chamada?.init.method).toBe('GET');
        expect(chamada?.init.headers).toMatchObject({ Authorization: `Bearer ${FAKE_TOKEN}` });
        expect(chamada?.init.redirect).toBe('manual');
        expect(response.body).toBeDefined();
      },
    );

    it('/me devolve a integracao', async () => {
      const response = await admin(`${BASE}/me`).expect(200);

      expect(response.body).toEqual({
        data: {
          id: 5421,
          nome: 'Integracao Ficticia',
          organizacao_id: 7432,
          scopes: ['financial-entries:read', 'issued-invoices:read'],
        },
      });
    });

    it('/financial/entries: parcelas, valores como texto decimal exato e paginacao', async () => {
      const response = await admin(`${BASE}/financial/entries?${PERIODO}`).expect(200);
      const body = response.body as {
        data: Array<{
          parcela_id: number;
          valor: string;
          saldo_atual: string;
          total_juros: null;
          status: unknown;
        }>;
        pagination: unknown;
      };

      expect(body.data.map((e) => e.parcela_id)).toEqual([482, 483]);
      expect(body.data[0]?.valor).toBe('8337.10');
      expect(body.data[0]?.saldo_atual).toBe('8337.10');
      expect(body.data[0]?.total_juros).toBeNull();
      expect(body.data[0]?.status).toEqual({ codigo: 2, descricao: 'Substituida' });
      expect(body.pagination).toEqual({
        perPage: 100,
        nextCursor: 'cur2',
        hasMore: true,
        pagesFetched: 1,
      });
    });

    it('/financial/account-statement: saldos do periodo', async () => {
      const response = await admin(
        `${BASE}/financial/account-statement?${PERIODO}&conta_id=11`,
      ).expect(200);

      expect((response.body as { saldos: unknown }).saldos).toEqual({
        saldo_anterior: '2605.14',
        saldo_final: '3470.10',
      });
    });

    it('/people sem links nem meta: hasMore null (a API nao informou)', async () => {
      const response = await admin(`${BASE}/people`).expect(200);

      expect((response.body as { pagination: { hasMore: unknown } }).pagination.hasMore).toBeNull();
    });

    it('/fiscal/issued-invoices nao tem XML nem DANFE', async () => {
      const response = await admin(`${BASE}/fiscal/issued-invoices?${PERIODO}`).expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/xml|danfe/i);
    });
  });

  describe('filtros e paginacao chegam ao Plantae', () => {
    it('todos os filtros, com a notacao campo[]', async () => {
      await admin(
        `${BASE}/financial/entries?${PERIODO}&tipo=despesa&status[]=0&status[]=1` +
          `&pessoa_id[]=4789&pessoa_id[]=213&razao_social_id=7&per_page=50`,
      ).expect(200);

      const { url } = chamadas()[0] ?? {};
      expect(url?.searchParams.get('tipo')).toBe('despesa');
      expect(url?.searchParams.getAll('status[]')).toEqual(['0', '1']);
      expect(url?.searchParams.getAll('pessoa_id[]')).toEqual(['4789', '213']);
      expect(url?.searchParams.getAll('razao_social_id[]')).toEqual(['7']);
      expect(url?.searchParams.get('per_page')).toBe('50');
    });

    it('o cursor vai ao Plantae exatamente como recebido', async () => {
      const opaco = 'eyJpZCI6MTIzfQ';

      await admin(`${BASE}/financial/entries?${PERIODO}&cursor=${opaco}`).expect(200);

      expect(chamadas()[0]?.url.searchParams.get('cursor')).toBe(opaco);
    });

    it('paginas=2 segue o cursor e faz exatamente 2 chamadas', async () => {
      plantaeResponde((p) =>
        jsonResponse(
          p === '/financial/entries'
            ? listJson([entryJson(1)], { nextCursor: chamadas().length < 2 ? 'cur2' : 'cur3' })
            : '{}',
        ),
      );

      const response = await admin(`${BASE}/financial/entries?${PERIODO}&paginas=2`).expect(200);

      expect(chamadas()).toHaveLength(2);
      expect(chamadas()[1]?.url.searchParams.get('cursor')).toBe('cur2');
      expect(
        (response.body as { pagination: { pagesFetched: number } }).pagination.pagesFetched,
      ).toBe(2);
    });

    it('o Plantae devolvendo o mesmo cursor: 424 PLANTAE_INVALID_RESPONSE (sem laco)', async () => {
      plantaeResponde(() => jsonResponse(listJson([entryJson(1)], { nextCursor: 'repetido' })));

      const response = await admin(
        `${BASE}/financial/entries?${PERIODO}&cursor=repetido&paginas=5`,
      ).expect(424);

      expect((response.body as { message: string }).message).toMatch(/^PLANTAE_INVALID_RESPONSE: /);
      expect(chamadas()).toHaveLength(1);
    });
  });

  describe('validacao dos filtros (400, sem chamar o Plantae)', () => {
    it.each([
      ['sem periodo', `${BASE}/financial/entries`],
      ['sem data_fim', `${BASE}/financial/entries?data_inicio=2026-09-01`],
      ['data impossivel', `${BASE}/financial/entries?data_inicio=2026-02-30&data_fim=2026-03-01`],
      ['periodo invertido', `${BASE}/financial/entries?data_inicio=2026-09-30&data_fim=2026-09-01`],
      [
        'periodo de 367 dias',
        `${BASE}/financial/movements?data_inicio=2024-01-01&data_fim=2025-01-01`,
      ],
      ['parametro desconhecido', `${BASE}/financial/entries?${PERIODO}&token=x`],
      ['tipo invalido', `${BASE}/financial/entries?${PERIODO}&tipo=outro`],
      ['status invalido', `${BASE}/financial/entries?${PERIODO}&status=9`],
      ['id nao numerico', `${BASE}/financial/entries?${PERIODO}&pessoa_id=abc`],
      ['per_page 501', `${BASE}/financial/entries?${PERIODO}&per_page=501`],
      ['per_page 0', `${BASE}/people?per_page=0`],
      ['paginas 6', `${BASE}/people?paginas=6`],
      ['cursor com espaco', `${BASE}/people?cursor=a%20b`],
      ['busca curta', `${BASE}/people?busca=a`],
      ['natureza invalida', `${BASE}/financial/movements?${PERIODO}&natureza=X`],
      ['origem 14', `${BASE}/financial/movements?${PERIODO}&origem=14`],
      ['extrato sem conta_id', `${BASE}/financial/account-statement?${PERIODO}`],
      [
        'extrato com 2 contas',
        `${BASE}/financial/account-statement?${PERIODO}&conta_id=1&conta_id=2`,
      ],
      ['situacao invalida', `${BASE}/fiscal/issued-invoices?${PERIODO}&situacao=denegada`],
      ['parametro aninhado', `${BASE}/people?busca[x]=1`],
    ])('%s', async (_nome, path) => {
      const response = await admin(path).expect(400);

      expect((response.body as { message: unknown }).message).toEqual(expect.any(Array));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('a mensagem de erro nao repete o termo de busca', async () => {
      const response = await admin(`${BASE}/people?busca=a&cursor=a%20b`).expect(400);

      expect(JSON.stringify(response.body)).not.toContain('a b');
    });
  });

  describe('erros do Plantae viram respostas claras, sem dado substituto', () => {
    const consulta = (): request.Test => admin(`${BASE}/people?busca=Fulano`);

    it.each([
      [401, 424, 'PLANTAE_AUTH_REJECTED'],
      [403, 424, 'PLANTAE_FORBIDDEN'],
      [404, 424, 'PLANTAE_UPSTREAM_ERROR'],
    ])('Plantae %i -> %i %s', async (upstream, status, codigo) => {
      plantaeResponde(() =>
        jsonResponse('{"message":"CPF 000.000.000-00 invalido"}', { status: upstream }),
      );

      const response = await consulta().expect(status);

      expect((response.body as { message: string }).message).toMatch(new RegExp(`^${codigo}: `));
      expect(JSON.stringify(response.body)).not.toContain('000.000.000-00');
      expect(chamadas()).toHaveLength(1);
    });

    it('422 -> 424 PLANTAE_REJECTED_PARAMETERS, com os NOMES dos parametros', async () => {
      plantaeResponde(() =>
        jsonResponse('{"message":"x","errors":{"busca":["valor 123.456.789-00 invalido"]}}', {
          status: 422,
        }),
      );

      const response = await consulta().expect(424);
      const mensagem = (response.body as { message: string }).message;

      expect(mensagem).toContain('PLANTAE_REJECTED_PARAMETERS');
      expect(mensagem).toContain('(parametros: busca)');
      expect(mensagem).not.toContain('123.456.789-00');
    });

    it('resposta fora do contrato -> 424 PLANTAE_INVALID_RESPONSE, nenhum dado parcial', async () => {
      plantaeResponde(() => jsonResponse(listJson([personJson(), '{"pessoa_id":"x"}'])));

      const response = await consulta().expect(424);

      expect((response.body as { message: string }).message).toMatch(/^PLANTAE_INVALID_RESPONSE: /);
      expect(JSON.stringify(response.body)).not.toContain('Pessoa Ficticia');
      expect((response.body as { data?: unknown }).data).toBeUndefined();
    });

    it.each([
      ['JSON malformado', () => jsonResponse('{"data": [quebrado')],
      [
        'content-type html',
        () =>
          new Response('<html>manutencao</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ],
      [
        'redirect',
        () =>
          new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/' } }),
      ],
    ])('%s -> 424 PLANTAE_INVALID_RESPONSE', async (_nome, fabrica) => {
      plantaeResponde(fabrica);

      const response = await consulta().expect(424);

      expect((response.body as { message: string }).message).toMatch(/^PLANTAE_INVALID_RESPONSE: /);
      expect(JSON.stringify(response.body)).not.toContain('evil.example.com');
    });

    it.each([
      ['DNS', 'ENOTFOUND', 'PLANTAE_UNREACHABLE'],
      ['TLS (certificado expirado)', 'CERT_HAS_EXPIRED', 'PLANTAE_TLS_ERROR'],
    ])('%s -> 424 %s', async (_nome, code, codigo) => {
      fetchSpy.mockImplementation(() => {
        const error = new TypeError('fetch failed');
        (error as { cause?: unknown }).cause = Object.assign(
          new Error(`falha em ${BASE_URL} com ${FAKE_TOKEN}`),
          { code },
        );
        return Promise.reject(error);
      });

      const response = await consulta().expect(424);

      expect((response.body as { message: string }).message).toMatch(new RegExp(`^${codigo}: `));
      expect(JSON.stringify(response.body)).not.toContain(FAKE_TOKEN);
      expect(JSON.stringify(response.body)).not.toContain('plantae.agr.br');
    });

    it('Plantae fora do ar (503 em todas as tentativas) -> 424 PLANTAE_UPSTREAM_ERROR apos 3 tentativas', async () => {
      plantaeResponde(() => jsonResponse('{}', { status: 503 }));

      const response = await consulta().expect(424);

      expect((response.body as { message: string }).message).toMatch(/^PLANTAE_UPSTREAM_ERROR: /);
      expect(chamadas()).toHaveLength(3);
    });

    it('timeout -> 424 PLANTAE_TIMEOUT', async () => {
      fetchSpy.mockImplementation(() =>
        Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' })),
      );

      const response = await consulta().expect(424);

      expect((response.body as { message: string }).message).toMatch(/^PLANTAE_TIMEOUT: /);
    });

    it('NUNCA ha fallback para dado local: a resposta de erro nao tem `data`', async () => {
      plantaeResponde(() => jsonResponse('{}', { status: 401 }));

      const response = await admin(`${BASE}/financial/entries?${PERIODO}`).expect(424);

      expect(Object.keys(response.body as object).sort()).toEqual([
        'error',
        'message',
        'path',
        'statusCode',
        'timestamp',
      ]);
    });
  });

  describe('auditoria', () => {
    it('registra QUEM consultou e O QUE, sem filtros de pessoa, conteudo, valores nem token', async () => {
      // Periodo exclusivo deste teste: outros testes tambem consultam este endpoint.
      await admin(
        `${BASE}/financial/entries?data_inicio=2026-01-01&data_fim=2026-01-31` +
          `&pessoa_id=4789&tipo=despesa&per_page=10`,
      ).expect(200);

      const eventos = await eventosDeAuditoria();
      const evento = eventos.find((e) => e.metadados?.de === '2026-01-01');

      expect(evento).toBeDefined();
      expect(evento?.modulo).toBe('PLANTAE');
      expect(evento?.descricao).toBe('Consulta ao Plantae: financial/entries');
      expect(evento?.metadados).toEqual({
        endpoint: 'financial/entries',
        ambiente: 'homologation',
        resultado: 'ok',
        paginas: 1,
        quantidade: 2,
        de: '2026-01-01',
        ate: '2026-01-31',
      });
    });

    it('a busca de pessoas NAO vai para a auditoria', async () => {
      await admin(`${BASE}/people?busca=SEGREDO-DE-BUSCA-999`).expect(200);

      const todos = JSON.stringify(await eventosDeAuditoria());

      expect(todos).not.toContain('SEGREDO-DE-BUSCA-999');
      expect(todos).toContain('"endpoint":"people"');
    });

    it('a falha do Plantae tambem e auditada, com o codigo', async () => {
      plantaeResponde(() => jsonResponse('{}', { status: 403 }));
      await admin(`${BASE}/financial/accounts`).expect(424);

      const evento = (await eventosDeAuditoria()).find(
        (e) => e.metadados?.endpoint === 'financial/accounts' && e.metadados.resultado === 'erro',
      );

      expect(evento?.metadados).toMatchObject({ codigo: 'PLANTAE_FORBIDDEN' });
    });

    it('filtro invalido (400) nao gera evento: nada foi consultado', async () => {
      const antes = (await eventosDeAuditoria()).length;

      await admin(`${BASE}/financial/entries`).expect(400);

      expect((await eventosDeAuditoria()).length).toBe(antes);
    });

    it('nenhum evento da trilha contem o token', async () => {
      await admin(`${BASE}/me`).expect(200);

      expect(JSON.stringify(await eventosDeAuditoria())).not.toContain(FAKE_TOKEN);
    });
  });

  describe('nenhum vazamento', () => {
    it('token, CPF/CNPJ, valores e termo de busca nao aparecem em NENHUM log', async () => {
      const espioes = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((nivel) =>
        jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined),
      );
      try {
        await admin(`${BASE}/people?busca=TERMO-SECRETO-777`).expect(200);
        await admin(`${BASE}/financial/entries?${PERIODO}`).expect(200);
        plantaeResponde(() => jsonResponse('{"message":"CPF 000.000.000-00"}', { status: 403 }));
        await admin(`${BASE}/people?busca=TERMO-SECRETO-777`).expect(424);
        await admin(`${BASE}/people?busca=a`).expect(400);

        const tudo = JSON.stringify(espioes.flatMap((e) => e.mock.calls));
        for (const proibido of [
          FAKE_TOKEN,
          'TERMO-SECRETO-777',
          '000.000.000-00',
          'Pessoa Ficticia',
          '8337.10',
        ]) {
          expect(tudo).not.toContain(proibido);
        }
        // Controle positivo: o log da consulta EXISTE (senao a prova acima seria vazia).
        expect(tudo).toContain('Plantae GET people');
      } finally {
        jest.restoreAllMocks();
        fetchSpy = jest.spyOn(globalThis, 'fetch');
      }
    });

    it('o token nao aparece em nenhuma resposta, nem de sucesso nem de erro', async () => {
      const respostas = [await admin(`${BASE}/me`), await admin(`${BASE}/status`)];
      plantaeResponde(() => jsonResponse('{}', { status: 401 }));
      respostas.push(await admin(`${BASE}/people`));

      for (const resposta of respostas) {
        expect(JSON.stringify(resposta.body)).not.toContain(FAKE_TOKEN);
        expect(JSON.stringify(resposta.headers)).not.toContain(FAKE_TOKEN);
      }
    });
  });

  describe('regressao', () => {
    it('login humano e rotas existentes continuam funcionando', async () => {
      await request(server()).post('/auth/login').send(ADMIN).expect(200);
      await admin('/auth/me').expect(200);
      await admin('/finance/entries').expect(200);
      await request(server()).get('/health').expect(200);
    });
  });

  // POR ULTIMO: um 429 com Retry-After longo poe o limitador em pausa por design,
  // e qualquer teste depois dele seria recusado localmente.
  describe('limite de taxa', () => {
    it('429 do Plantae -> 429 PLANTAE_RATE_LIMITED, com o tempo de espera', async () => {
      plantaeResponde(() =>
        jsonResponse('{}', { status: 429, headers: { 'Retry-After': '3091' } }),
      );

      const response = await admin(`${BASE}/people`).expect(429);

      expect((response.body as { message: string }).message).toMatch(
        /^PLANTAE_RATE_LIMITED: .*Tente novamente em 3091 s/,
      );
      expect(chamadas()).toHaveLength(1);
    });

    it('enquanto durar a pausa, as consultas nem saem do processo', async () => {
      const response = await admin(`${BASE}/financial/accounts`).expect(429);

      expect((response.body as { message: string }).message).toContain('PLANTAE_RATE_LIMITED');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('o limite continua valendo para quem e ADMIN: nada contorna a pausa', async () => {
      for (const [, path] of ROTAS.filter(([nome]) => nome !== 'status')) {
        await admin(path).expect(429);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
