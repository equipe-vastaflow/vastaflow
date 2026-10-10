import { PlantaeInputError } from './plantae-errors';
import {
  parseAccountsQuery,
  parseEntriesQuery,
  parseInvoicesQuery,
  parseLegalEntitiesQuery,
  parseMovementsQuery,
  parsePeopleQuery,
  parseStatementQuery,
} from './plantae-query.parser';

const PERIODO = { data_inicio: '2026-09-01', data_fim: '2026-09-30' };

function problemas(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof PlantaeInputError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('deveria ter falhado');
}

describe('parseEntriesQuery', () => {
  it('converte o periodo e os filtros para o tipo', () => {
    expect(
      parseEntriesQuery({
        ...PERIODO,
        tipo: 'receita',
        status: ['0', '1'],
        pessoa_id: ['4789', '213'],
        razao_social_id: '7',
        per_page: '50',
        cursor: 'abc',
        paginas: '2',
      }),
    ).toEqual({
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      tipo: 'receita',
      status: [0, 1],
      pessoaIds: [4789, 213],
      razaoSocialIds: [7],
      perPage: 50,
      cursor: 'abc',
      maxPages: 2,
    });
  });

  it('aceita a grafia campo[] (o Express 5 entrega o "[]" no nome)', () => {
    const query = parseEntriesQuery({
      ...PERIODO,
      'pessoa_id[]': ['1', '2'],
      'status[]': '2',
    });

    expect(query.pessoaIds).toEqual([1, 2]);
    expect(query.status).toEqual([2]);
  });

  it('uma lista pode misturar as duas grafias', () => {
    expect(parseEntriesQuery({ ...PERIODO, pessoa_id: '1', 'pessoa_id[]': '2' }).pessoaIds).toEqual(
      [1, 2],
    );
  });

  it('o resultado nao tem chaves undefined', () => {
    expect(Object.keys(parseEntriesQuery(PERIODO)).sort()).toEqual(['dataFim', 'dataInicio']);
  });

  it('exige data_inicio e data_fim', () => {
    expect(problemas(() => parseEntriesQuery({}))).toEqual([
      'data_inicio e obrigatorio',
      'data_fim e obrigatorio',
    ]);
  });

  it('recusa parametro desconhecido (nunca ignora em silencio)', () => {
    expect(problemas(() => parseEntriesQuery({ ...PERIODO, token: 'x' }))).toEqual([
      'parametro desconhecido: token',
    ]);
  });

  it('nao repete de volta um nome de parametro estranho', () => {
    const erro = problemas(() =>
      parseEntriesQuery({ ...PERIODO, '<script>alert(1)</script>': 'x' }),
    );

    expect(erro).toEqual(['parametro desconhecido: (nome invalido)']);
  });

  it.each([
    ['decimal', '1.5'],
    ['negativo', '-1'],
    ['texto', 'abc'],
    ['vazio', ''],
    ['notacao cientifica', '1e3'],
    ['hexadecimal', '0x10'],
    ['com espaco', ' 7'],
    ['grande demais para inteiro seguro', '99999999999999999'],
  ])('recusa id %s', (_nome, valor) => {
    expect(problemas(() => parseEntriesQuery({ ...PERIODO, pessoa_id: valor }))).toEqual([
      'pessoa_id deve ser um inteiro',
    ]);
  });

  it('data_inicio repetido', () => {
    expect(
      problemas(() => parseEntriesQuery({ ...PERIODO, data_inicio: ['2026-09-01', '2026-09-02'] })),
    ).toEqual(['data_inicio aceita um unico valor']);
  });

  it('valor aninhado (a[b]=c) e recusado', () => {
    expect(problemas(() => parseEntriesQuery({ ...PERIODO, pessoa_id: { a: '1' } }))).toEqual([
      'pessoa_id deve ser texto',
    ]);
  });

  it.each([
    ['tipo', { tipo: 'outro' }],
    ['status', { status: '5' }],
  ])('recusa %s invalido', (_nome, extra) => {
    expect(problemas(() => parseEntriesQuery({ ...PERIODO, ...extra }))).toHaveLength(1);
  });

  it('as regras de VALOR (periodo) ficam no build, nao aqui', () => {
    expect(() => parseEntriesQuery({ data_inicio: '2026-02-30', data_fim: 'x' })).not.toThrow();
  });
});

describe('demais parsers', () => {
  it('accounts: tipo[]', () => {
    expect(parseAccountsQuery({ 'tipo[]': ['1', '4'] })).toEqual({ tipos: [1, 4] });
    expect(problemas(() => parseAccountsQuery({ tipo: '9' }))).toEqual(['tipo invalido']);
  });

  it('movements: conta, natureza, origem e conciliado', () => {
    expect(
      parseMovementsQuery({
        ...PERIODO,
        conta_id: '11',
        natureza: 'D',
        origem: ['1', '2'],
        conciliado: 'false',
      }),
    ).toEqual({
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      contaIds: [11],
      natureza: 'D',
      origens: [1, 2],
      conciliado: false,
    });
  });

  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ])('conciliado=%s -> %p', (texto, esperado) => {
    expect(parseMovementsQuery({ ...PERIODO, conciliado: texto }).conciliado).toBe(esperado);
  });

  it('conciliado invalido', () => {
    expect(problemas(() => parseMovementsQuery({ ...PERIODO, conciliado: 'sim' }))).toEqual([
      'conciliado deve ser 1, 0, true ou false',
    ]);
  });

  it('statement: conta_id obrigatorio e unico', () => {
    expect(parseStatementQuery({ ...PERIODO, conta_id: '11' }).contaId).toBe(11);
    expect(problemas(() => parseStatementQuery(PERIODO))).toEqual(['conta_id e obrigatorio']);
    expect(problemas(() => parseStatementQuery({ ...PERIODO, conta_id: ['1', '2'] }))).toEqual([
      'conta_id aceita um unico valor',
    ]);
    expect(problemas(() => parseStatementQuery({ ...PERIODO, conta_id: 'x' }))).toEqual([
      'conta_id deve ser um inteiro',
    ]);
  });

  it('invoices: situacao, operacao e razao social', () => {
    expect(
      parseInvoicesQuery({
        ...PERIODO,
        situacao: 'autorizada',
        operacao: 'entrada',
        razao_social_id: '155',
      }),
    ).toMatchObject({ situacao: 'autorizada', operacao: 'entrada', razaoSocialIds: [155] });
    expect(problemas(() => parseInvoicesQuery({ ...PERIODO, situacao: 'denegada' }))).toEqual([
      'situacao invalido',
    ]);
  });

  it('legal-entities: so paginacao', () => {
    expect(parseLegalEntitiesQuery({ per_page: '10' })).toEqual({ perPage: 10 });
    expect(problemas(() => parseLegalEntitiesQuery({ busca: 'x' }))).toEqual([
      'parametro desconhecido: busca',
    ]);
  });

  it('people: busca', () => {
    expect(parsePeopleQuery({ busca: 'agro' })).toEqual({ busca: 'agro' });
    expect(parsePeopleQuery({})).toEqual({});
  });

  it('acumula problemas de campos diferentes', () => {
    const erros = problemas(() => parseMovementsQuery({ natureza: 'Z', origem: 'x', extra: '1' }));

    expect(erros).toHaveLength(5);
    expect(erros).toEqual(
      expect.arrayContaining([
        'natureza invalido',
        'origem deve ser um inteiro',
        'data_inicio e obrigatorio',
        'data_fim e obrigatorio',
        'parametro desconhecido: extra',
      ]),
    );
  });
});
