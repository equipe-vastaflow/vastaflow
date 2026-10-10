import { Logger } from '@nestjs/common';
import {
  accountJson,
  BASE_URL,
  entryJson,
  FAKE_TOKEN,
  invoiceJson,
  legalEntityJson,
  listJson,
  ME_JSON,
  movementJson,
  personJson,
} from '../../../../test/support/plantae-fixtures';
import { PlantaeApiError, PlantaeInputError } from './plantae-errors';
import type { PlantaeHttpClient } from './plantae-http.client';
import { parsePlantaeJson } from './plantae-json';
import { PlantaeEndpoint, type PlantaeEndpointPath } from './plantae.constants';
import { PlantaeService } from './plantae.service';

type GetFn = (endpoint: PlantaeEndpointPath, params: URLSearchParams) => Promise<unknown>;

const PERIODO = { dataInicio: '2026-09-01', dataFim: '2026-09-30' };

function montar(responses: readonly string[]): {
  service: PlantaeService;
  get: jest.Mock<ReturnType<GetFn>, Parameters<GetFn>>;
} {
  const queue = [...responses];
  const get = jest.fn<ReturnType<GetFn>, Parameters<GetFn>>(() => {
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error('resposta nao programada'));
    }
    return Promise.resolve(parsePlantaeJson(next));
  });
  const config = {
    get: <T>(key: string): T | undefined =>
      ({ PLANTAE_ENABLED: true, PLANTAE_BASE_URL: BASE_URL })[key] as T | undefined,
  };
  return { service: new PlantaeService({ get } as unknown as PlantaeHttpClient, config), get };
}

async function falha(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('deveria ter falhado');
}

const pagina = (nextCursor: string | null, items = [entryJson()]): string =>
  listJson(items, { nextCursor });

describe('PlantaeService: uma pagina', () => {
  it('le a primeira pagina e informa que ha mais', async () => {
    const { service, get } = montar([pagina('cur2')]);

    const result = await service.listEntries(PERIODO);

    expect(result.items).toHaveLength(1);
    expect(result.pagination).toEqual({
      perPage: 100,
      nextCursor: 'cur2',
      hasMore: true,
      pagesFetched: 1,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('por padrao le UMA pagina (nunca coleta tudo sozinho)', async () => {
    const { service, get } = montar([pagina('cur2'), pagina('cur3'), pagina(null)]);

    await service.listEntries(PERIODO);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('ultima pagina: hasMore false e cursor null', async () => {
    const { service } = montar([pagina(null)]);

    expect((await service.listEntries(PERIODO)).pagination).toMatchObject({
      nextCursor: null,
      hasMore: false,
    });
  });

  it('chama o endpoint certo, com os filtros', async () => {
    const { service, get } = montar([pagina(null)]);

    await service.listEntries({ ...PERIODO, tipo: 'despesa', pessoaIds: [4789], perPage: 25 });

    const [endpoint, params] = get.mock.calls[0] ?? [];
    expect(endpoint).toBe(PlantaeEndpoint.FinancialEntries);
    expect(params?.get('data_inicio')).toBe('2026-09-01');
    expect(params?.get('tipo')).toBe('despesa');
    expect(params?.getAll('pessoa_id[]')).toEqual(['4789']);
    expect(params?.get('per_page')).toBe('25');
    expect(params?.has('cursor')).toBe(false);
  });

  it('o cursor recebido e enviado EXATAMENTE como veio', async () => {
    const opaco = 'eyJpZCI6MTIzLCJ4Ijoie30ifQ==';
    const { service, get } = montar([pagina(null)]);

    await service.listEntries({ ...PERIODO, cursor: opaco });

    expect(get.mock.calls[0]?.[1].get('cursor')).toBe(opaco);
  });
});

describe('PlantaeService: varias paginas', () => {
  it('segue meta.next_cursor ate o fim', async () => {
    const { service, get } = montar([
      pagina('c2', [entryJson(1)]),
      pagina('c3', [entryJson(2)]),
      pagina(null, [entryJson(3)]),
    ]);

    const result = await service.listEntries({ ...PERIODO, maxPages: 5 });

    expect(result.items.map((e) => e.parcela_id)).toEqual([1, 2, 3]);
    expect(result.pagination).toMatchObject({ pagesFetched: 3, nextCursor: null, hasMore: false });
    expect(get.mock.calls.map(([, params]) => params.get('cursor'))).toEqual([null, 'c2', 'c3']);
  });

  it('os filtros acompanham TODAS as paginas', async () => {
    const { service, get } = montar([pagina('c2'), pagina(null)]);

    await service.listEntries({ ...PERIODO, tipo: 'receita', maxPages: 2 });

    for (const [, params] of get.mock.calls) {
      expect(params.get('tipo')).toBe('receita');
      expect(params.get('data_inicio')).toBe('2026-09-01');
    }
  });

  it('para no limite de paginas e devolve o cursor para continuar', async () => {
    const { service, get } = montar([pagina('c2'), pagina('c3'), pagina('c4')]);

    const result = await service.listEntries({ ...PERIODO, maxPages: 2 });

    expect(get).toHaveBeenCalledTimes(2);
    expect(result.pagination).toMatchObject({ pagesFetched: 2, nextCursor: 'c3', hasMore: true });
  });

  it('para no teto de itens, mesmo com paginas sobrando', async () => {
    const mil = Array.from({ length: 1000 }, (_, i) => accountJson(i + 1));
    const { service, get } = montar([
      listJson(mil, { endpoint: 'financial/accounts', nextCursor: 'c2' }),
      listJson(mil, { endpoint: 'financial/accounts', nextCursor: 'c3' }),
      listJson(mil, { endpoint: 'financial/accounts', nextCursor: 'c4' }),
      listJson(mil, { endpoint: 'financial/accounts', nextCursor: 'c5' }),
    ]);

    const result = await service.listAccounts({ maxPages: 5 });

    expect(get).toHaveBeenCalledTimes(3);
    expect(result.items).toHaveLength(3000);
    expect(result.pagination.hasMore).toBe(true);
  });
});

describe('PlantaeService: laco de cursor', () => {
  it('a resposta repete o cursor que acabamos de enviar: cursor-loop', async () => {
    const { service } = montar([pagina('mesmo')]);

    const erro = await falha(service.listEntries({ ...PERIODO, cursor: 'mesmo' }));

    expect(erro).toBeInstanceOf(PlantaeApiError);
    expect((erro as PlantaeApiError).kind).toBe('cursor-loop');
  });

  it('A -> B -> A: cursor-loop em vez de laco infinito', async () => {
    const { service, get } = montar([pagina('B'), pagina('A'), pagina('B'), pagina('A')]);

    const erro = await falha(service.listEntries({ ...PERIODO, cursor: 'A', maxPages: 5 }));

    expect((erro as PlantaeApiError).kind).toBe('cursor-loop');
    expect(get.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('cursor-loop vale mesmo quando so se le uma pagina', async () => {
    const { service } = montar([pagina('X')]);

    expect(
      ((await falha(service.listEntries({ ...PERIODO, cursor: 'X' }))) as PlantaeApiError).kind,
    ).toBe('cursor-loop');
  });
});

describe('PlantaeService: links.next', () => {
  it('NUNCA e seguido como destino: so o cliente do Plantae e chamado, sempre pelo endpoint', async () => {
    const { service, get } = montar([pagina('c2'), pagina(null)]);

    await service.listEntries({ ...PERIODO, maxPages: 2 });

    expect(get.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      PlantaeEndpoint.FinancialEntries,
      PlantaeEndpoint.FinancialEntries,
    ]);
  });

  it.each([
    ['outro host', 'https://evil.example.com/api/v1/external/financial/entries?cursor=zzz'],
    [
      'subdominio parecido',
      'https://rc.plantae.agr.br.evil.com/api/v1/external/financial/entries?cursor=zzz',
    ],
    ['http', 'http://rc.plantae.agr.br/api/v1/external/financial/entries?cursor=zzz'],
    ['outro endpoint', `${BASE_URL}/people?cursor=zzz`],
    ['outro caminho', 'https://rc.plantae.agr.br/outra/coisa?cursor=zzz'],
    [
      'com credencial',
      'https://u:p@rc.plantae.agr.br/api/v1/external/financial/entries?cursor=zzz',
    ],
    ['com porta', 'https://rc.plantae.agr.br:9999/api/v1/external/financial/entries?cursor=zzz'],
    ['relativo', '/api/v1/external/financial/entries?cursor=zzz'],
    ['nao e URL', 'string'],
  ])('destino invalido (%s): invalid-response', async (_nome, link) => {
    const { service } = montar([
      listJson([entryJson()], { nextCursor: 'zzz', linkNextOverride: link }),
    ]);

    const erro = await falha(service.listEntries(PERIODO));

    expect((erro as PlantaeApiError).kind).toBe('invalid-response');
    expect(JSON.stringify((erro as PlantaeApiError).detail)).not.toContain('evil.example.com');
  });

  it('sem meta, o cursor sai do parametro cursor do proprio link validado', async () => {
    const link = `${BASE_URL}/financial/entries?per_page=100&cursor=daLink`;
    const { service } = montar([
      listJson([entryJson()], { withMeta: false, linkNextOverride: link }),
    ]);

    expect((await service.listEntries(PERIODO)).pagination).toMatchObject({
      nextCursor: 'daLink',
      hasMore: true,
    });
  });

  it('link e meta que discordam: pagination-inconsistent', async () => {
    const { service } = montar([
      listJson([entryJson()], {
        nextCursor: 'doMeta',
        linkNextOverride: `${BASE_URL}/financial/entries?cursor=doLink`,
      }),
    ]);

    expect(((await falha(service.listEntries(PERIODO))) as PlantaeApiError).kind).toBe(
      'pagination-inconsistent',
    );
  });

  it('links.next presente mas meta.next_cursor null: pagination-inconsistent', async () => {
    const { service } = montar([
      listJson([entryJson()], {
        nextCursor: null,
        linkNextOverride: `${BASE_URL}/financial/entries?cursor=zzz`,
      }),
    ]);

    expect(((await falha(service.listEntries(PERIODO))) as PlantaeApiError).kind).toBe(
      'pagination-inconsistent',
    );
  });

  it('meta.next_cursor presente mas links.next null: pagination-inconsistent', async () => {
    const { service } = montar([
      listJson([entryJson()], { nextCursor: 'zzz', linkNextOverride: null }),
    ]);

    expect(((await falha(service.listEntries(PERIODO))) as PlantaeApiError).kind).toBe(
      'pagination-inconsistent',
    );
  });

  it('link sem parametro cursor e sem meta: pagination-inconsistent (nao finge que acabou)', async () => {
    const { service } = montar([
      listJson([entryJson()], {
        withMeta: false,
        linkNextOverride: `${BASE_URL}/financial/entries?per_page=100`,
      }),
    ]);

    expect(((await falha(service.listEntries(PERIODO))) as PlantaeApiError).kind).toBe(
      'pagination-inconsistent',
    );
  });
});

describe('PlantaeService: resposta sem informacao de paginacao', () => {
  it('sem links e sem meta: hasMore null (nao afirma que acabou)', async () => {
    const { service, get } = montar([
      listJson([personJson()], { withLinks: false, withMeta: false }),
    ]);

    const result = await service.listPeople({ maxPages: 5 });

    expect(result.pagination).toEqual({
      perPage: null,
      nextCursor: null,
      hasMore: null,
      pagesFetched: 1,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('PlantaeService: validacao ANTES da rede', () => {
  it('filtro invalido: rejeita a Promise (nao lanca sincrono) e nao chama o Plantae', async () => {
    const { service, get } = montar([]);

    let promise: Promise<unknown> | undefined;
    expect(() => {
      promise = service.listEntries({ dataInicio: '2026-02-30', dataFim: '2026-03-01' });
    }).not.toThrow();
    const erro = await falha(promise as Promise<unknown>);

    expect(erro).toBeInstanceOf(PlantaeInputError);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ['periodo de 367 dias', { dataInicio: '2024-01-01', dataFim: '2025-01-01' }],
    ['periodo invertido', { dataInicio: '2026-09-30', dataFim: '2026-09-01' }],
  ])('%s', async (_nome, periodo) => {
    const { service, get } = montar([]);

    expect(await falha(service.listMovements(periodo))).toBeInstanceOf(PlantaeInputError);
    expect(get).not.toHaveBeenCalled();
  });

  it('cursor invalido e recusado antes da rede', async () => {
    const { service, get } = montar([]);

    expect(await falha(service.listLegalEntities({ cursor: 'tem espaco' }))).toBeInstanceOf(
      PlantaeInputError,
    );
    expect(get).not.toHaveBeenCalled();
  });
});

describe('PlantaeService: demais recursos', () => {
  it('getMe', async () => {
    const { service, get } = montar([ME_JSON]);

    const me = await service.getMe();

    expect(me.organizacao_id).toBe(7432);
    expect(get.mock.calls[0]?.[0]).toBe(PlantaeEndpoint.Me);
  });

  it('listAccounts', async () => {
    const { service, get } = montar([
      listJson([accountJson()], { endpoint: 'financial/accounts' }),
    ]);

    const result = await service.listAccounts({ tipos: [2] });

    expect(result.items[0]?.conta_id).toBe(1496);
    expect(get.mock.calls[0]?.[1].getAll('tipo[]')).toEqual(['2']);
  });

  it('listMovements', async () => {
    const { service, get } = montar([
      listJson([movementJson()], { endpoint: 'financial/movements' }),
    ]);

    await service.listMovements({ ...PERIODO, natureza: 'C', conciliado: true });

    expect(get.mock.calls[0]?.[0]).toBe(PlantaeEndpoint.FinancialMovements);
    expect(get.mock.calls[0]?.[1].get('conciliado')).toBe('1');
  });

  it('listIssuedInvoices', async () => {
    const { service, get } = montar([
      listJson([invoiceJson()], { endpoint: 'fiscal/issued-invoices' }),
    ]);

    const result = await service.listIssuedInvoices({ ...PERIODO, situacao: 'autorizada' });

    expect(result.items[0]?.modelo).toBe('55');
    expect(get.mock.calls[0]?.[0]).toBe(PlantaeEndpoint.FiscalIssuedInvoices);
  });

  it('listLegalEntities', async () => {
    const { service } = montar([
      listJson([legalEntityJson()], { endpoint: 'organization/legal-entities' }),
    ]);

    expect((await service.listLegalEntities({})).items[0]?.razao_social_id).toBe(2187);
  });

  it('listPeople', async () => {
    const { service, get } = montar([listJson([personJson()], { endpoint: 'people' })]);

    await service.listPeople({ busca: 'agro' });

    expect(get.mock.calls[0]?.[1].get('busca')).toBe('agro');
  });
});

describe('PlantaeService: extrato', () => {
  const extrato = (next: string | null, anterior = '2605.14', final = '3470.10'): string =>
    listJson([movementJson()], {
      withLinks: false,
      endpoint: 'financial/account-statement',
      nextCursor: next,
      metaExtra: `"saldo_anterior":${anterior},"saldo_final":${final}`,
    });

  it('devolve os saldos do PERIODO, como texto exato', async () => {
    const { service } = montar([extrato(null)]);

    const result = await service.getAccountStatement({ ...PERIODO, contaId: 11 });

    expect(result.saldoAnterior).toBe('2605.14');
    expect(result.saldoFinal).toBe('3470.10');
  });

  it('com varias paginas, os saldos NAO sao somados', async () => {
    const { service } = montar([extrato('c2'), extrato(null)]);

    const result = await service.getAccountStatement({ ...PERIODO, contaId: 11, maxPages: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.saldoAnterior).toBe('2605.14');
    expect(result.saldoFinal).toBe('3470.10');
  });

  it('saldos diferentes entre paginas: invalid-response', async () => {
    const { service } = montar([extrato('c2'), extrato(null, '2605.14', '9999.99')]);

    const erro = await falha(service.getAccountStatement({ ...PERIODO, contaId: 11, maxPages: 2 }));

    expect((erro as PlantaeApiError).kind).toBe('invalid-response');
  });

  it('envia conta_id e periodo', async () => {
    const { service, get } = montar([extrato(null)]);

    await service.getAccountStatement({ ...PERIODO, contaId: 11 });

    expect(get.mock.calls[0]?.[1].get('conta_id')).toBe('11');
  });
});

describe('PlantaeService: erros e log', () => {
  it('erro do cliente passa sem alteracao', async () => {
    const { service, get } = montar([]);
    const original = new PlantaeApiError('timeout');
    get.mockRejectedValue(original);

    expect(await falha(service.getMe())).toBe(original);
  });

  it('resposta fora do contrato: invalid-response, sem dado parcial', async () => {
    const { service } = montar([listJson([entryJson(1), '{"parcela_id":"x"}'])]);

    const erro = await falha(service.listEntries(PERIODO));

    expect((erro as PlantaeApiError).kind).toBe('invalid-response');
    expect((erro as PlantaeApiError).detail.where).toBe('data[1].parcela_id [inteiro]');
  });

  describe('log', () => {
    let log: jest.SpyInstance<void, unknown[]>;
    let warn: jest.SpyInstance<void, unknown[]>;

    beforeEach(() => {
      log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('sucesso: so endpoint, paginas, itens e tempo', async () => {
      const { service } = montar([listJson([personJson(), personJson(7)], { endpoint: 'people' })]);

      await service.listPeople({ busca: 'Fulano 000.000.000-00' });

      const linha = String(log.mock.calls[0]?.[0]);
      expect(linha).toMatch(/^Plantae GET people ok paginas=1 itens=2 \d+ms$/);
    });

    it('nao registra filtros, pessoas, CPF/CNPJ, valores nem token', async () => {
      const { service } = montar([listJson([personJson(), personJson(7)], { endpoint: 'people' })]);

      await service.listPeople({ busca: 'TERMO-DE-BUSCA-SECRETO' });

      const tudo = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
      for (const proibido of [
        'TERMO-DE-BUSCA-SECRETO',
        'Pessoa Ficticia',
        '000.000.000-00',
        FAKE_TOKEN,
      ]) {
        expect(tudo).not.toContain(proibido);
      }
    });

    it('falha do Plantae: a categoria, nunca o corpo', async () => {
      const { service, get } = montar([]);
      get.mockRejectedValue(new PlantaeApiError('forbidden', { httpStatus: 403 }));

      await falha(service.listPeople({ busca: 'TERMO-SECRETO' }));

      const linha = String(warn.mock.calls[0]?.[0]);
      expect(linha).toContain('Plantae GET people Plantae falhou: forbidden 403');
      expect(linha).not.toContain('TERMO-SECRETO');
    });

    it('filtro invalido nao e registrado como falha do Plantae', async () => {
      const { service } = montar([]);

      await falha(service.listEntries({ dataInicio: 'x', dataFim: 'y' }));

      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe('PlantaeService: movimentacoes sem `saldo` (formato real observado)', () => {
  it('a listagem funciona e informa saldo null', async () => {
    const { service } = montar([
      listJson([movementJson(1, { semSaldo: true })], { endpoint: 'financial/movements' }),
    ]);

    const result = await service.listMovements(PERIODO);

    expect(result.items[0]?.saldo).toBeNull();
    expect(result.items[0]?.valor).toBe('1503.20');
  });

  it('o extrato SEM `saldo` por linha continua sendo recusado, sem dado parcial', async () => {
    const { service } = montar([
      listJson([movementJson(1, { semSaldo: true })], {
        withLinks: false,
        endpoint: 'financial/account-statement',
        metaExtra: '"saldo_anterior":1.00,"saldo_final":2.00',
      }),
    ]);

    const erro = await falha(service.getAccountStatement({ ...PERIODO, contaId: 11 }));

    expect((erro as PlantaeApiError).kind).toBe('invalid-response');
    expect((erro as PlantaeApiError).detail.where).toBe('data[0].saldo [ausente]');
  });
});
