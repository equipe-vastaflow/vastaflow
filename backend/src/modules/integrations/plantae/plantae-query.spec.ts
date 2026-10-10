import { PlantaeInputError } from './plantae-errors';
import {
  buildAccountsParams,
  buildEntriesParams,
  buildInvoicesParams,
  buildLegalEntitiesParams,
  buildMeParams,
  buildMovementsParams,
  buildPeopleParams,
  buildStatementParams,
  effectiveMaxPages,
} from './plantae-query';

const PERIODO = { dataInicio: '2026-09-01', dataFim: '2026-09-30' };

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

describe('buildEntriesParams', () => {
  it('monta so o periodo quando nao ha mais filtros', () => {
    expect(buildEntriesParams(PERIODO).toString()).toBe(
      'data_inicio=2026-09-01&data_fim=2026-09-30',
    );
  });

  it('usa os nomes e a notacao de lista da colecao (campo[]=1&campo[]=2)', () => {
    const params = buildEntriesParams({
      ...PERIODO,
      perPage: 200,
      tipo: 'despesa',
      status: [0, 1],
      pessoaIds: [4789, 213],
      razaoSocialIds: [7],
    });

    expect(params.get('per_page')).toBe('200');
    expect(params.get('tipo')).toBe('despesa');
    expect(params.getAll('status[]')).toEqual(['0', '1']);
    expect(params.getAll('pessoa_id[]')).toEqual(['4789', '213']);
    expect(params.getAll('razao_social_id[]')).toEqual(['7']);
  });

  it('NAO inclui o cursor: quem pagina e o servico', () => {
    expect(buildEntriesParams({ ...PERIODO, cursor: 'abc' }).has('cursor')).toBe(false);
  });

  it('valores sao codificados, nunca concatenados', () => {
    const params = buildPeopleParams({ busca: 'a&b=c#d' });

    expect(params.toString()).toBe('busca=a%26b%3Dc%23d');
  });

  it('status 2 (substituida) e aceito; status 3 nao', () => {
    expect(() => buildEntriesParams({ ...PERIODO, status: [2] })).not.toThrow();
    expect(problemas(() => buildEntriesParams({ ...PERIODO, status: [3 as never] }))).toEqual([
      'status invalido',
    ]);
  });

  it('recusa tipo desconhecido', () => {
    expect(
      problemas(() => buildEntriesParams({ ...PERIODO, tipo: 'transferencia' as never })),
    ).toEqual(['tipo invalido']);
  });

  it('exige periodo valido e acumula TODOS os problemas', () => {
    expect(
      problemas(() =>
        buildEntriesParams({
          dataInicio: '2026-02-30',
          dataFim: '2026-03-01',
          perPage: 0,
          status: [],
        }),
      ),
    ).toEqual([
      'per_page deve ser de 1 a 500',
      'data_inicio deve ser uma data real no formato AAAA-MM-DD',
      'status deve ter de 1 a 3 valores',
    ]);
  });

  it('periodo maior que 366 dias', () => {
    expect(
      problemas(() => buildEntriesParams({ dataInicio: '2024-01-01', dataFim: '2025-01-01' })),
    ).toEqual(['o periodo pode ter no maximo 366 dias']);
  });

  it.each([
    ['zero', [0]],
    ['negativo', [-1]],
    ['decimal', [1.5]],
    ['inteiro inseguro', [Number.MAX_SAFE_INTEGER + 1]],
    ['NaN', [Number.NaN]],
    ['lista vazia', []],
  ])('pessoa_id: recusa %s', (_nome, ids) => {
    expect(problemas(() => buildEntriesParams({ ...PERIODO, pessoaIds: ids }))).toHaveLength(1);
  });

  it('pessoa_id: no maximo 50 ids', () => {
    const cinquenta = Array.from({ length: 50 }, (_, i) => i + 1);

    expect(() => buildEntriesParams({ ...PERIODO, pessoaIds: cinquenta })).not.toThrow();
    expect(
      problemas(() => buildEntriesParams({ ...PERIODO, pessoaIds: [...cinquenta, 51] })),
    ).toEqual(['pessoa_id deve ter de 1 a 50 valores']);
  });
});

describe('paginacao e cursor', () => {
  it.each([1, 100, 500])('per_page %i e aceito', (perPage) => {
    expect(buildLegalEntitiesParams({ perPage }).get('per_page')).toBe(String(perPage));
  });

  it.each([0, -1, 501, 1.5, Number.NaN])('per_page %p e recusado', (perPage) => {
    expect(problemas(() => buildLegalEntitiesParams({ perPage }))).toEqual([
      'per_page deve ser de 1 a 500',
    ]);
  });

  it('sem per_page, nao envia (vale o padrao 100 da API)', () => {
    expect(buildLegalEntitiesParams({}).toString()).toBe('');
  });

  it.each([1, 3, 5])('paginas %i e aceito', (maxPages) => {
    expect(() => buildLegalEntitiesParams({ maxPages })).not.toThrow();
  });

  it.each([0, 6, 2.5, -1])('paginas %p e recusado (nunca coleta ilimitada)', (maxPages) => {
    expect(problemas(() => buildLegalEntitiesParams({ maxPages }))).toEqual([
      'paginas deve ser de 1 a 5',
    ]);
  });

  it('o padrao e UMA pagina', () => {
    expect(effectiveMaxPages({})).toBe(1);
    expect(effectiveMaxPages({ maxPages: 3 })).toBe(3);
  });

  it('aceita cursor opaco comum (base64, base64url)', () => {
    expect(() => buildLegalEntitiesParams({ cursor: 'eyJpZCI6MTIzfQ' })).not.toThrow();
    expect(() => buildLegalEntitiesParams({ cursor: 'a+b/c=d_e-f' })).not.toThrow();
  });

  it.each([
    ['vazio', ''],
    ['com espaco', 'abc def'],
    ['com quebra de linha', 'abc\ndef'],
    ['com acento', 'cursér'],
    ['grande demais', 'a'.repeat(2049)],
  ])('recusa cursor %s', (_nome, cursor) => {
    expect(problemas(() => buildLegalEntitiesParams({ cursor }))).toEqual(['cursor invalido']);
  });
});

describe('buildAccountsParams', () => {
  it('tipo[] com 1 a 4', () => {
    expect(buildAccountsParams({ tipos: [1, 2] }).getAll('tipo[]')).toEqual(['1', '2']);
  });

  it.each([0, 5])('recusa tipo %i', (tipo) => {
    expect(problemas(() => buildAccountsParams({ tipos: [tipo as never] }))).toEqual([
      'tipo invalido',
    ]);
  });

  it('sem filtros: query vazia', () => {
    expect(buildAccountsParams({}).toString()).toBe('');
  });
});

describe('buildMovementsParams', () => {
  it('monta todos os filtros', () => {
    const params = buildMovementsParams({
      ...PERIODO,
      contaIds: [11],
      natureza: 'C',
      origens: [1, 13],
      conciliado: false,
    });

    expect(params.getAll('conta_id[]')).toEqual(['11']);
    expect(params.get('natureza')).toBe('C');
    expect(params.getAll('origem[]')).toEqual(['1', '13']);
    expect(params.get('conciliado')).toBe('0');
  });

  it('conciliado=true vira 1', () => {
    expect(buildMovementsParams({ ...PERIODO, conciliado: true }).get('conciliado')).toBe('1');
  });

  it.each([0, 14])('origem %i fora de 1..13', (origem) => {
    expect(problemas(() => buildMovementsParams({ ...PERIODO, origens: [origem] }))).toEqual([
      'origem deve conter inteiros de 1 a 13',
    ]);
  });

  it('natureza so C ou D', () => {
    expect(problemas(() => buildMovementsParams({ ...PERIODO, natureza: 'X' as never }))).toEqual([
      'natureza invalido',
    ]);
  });

  it('exige periodo', () => {
    expect(problemas(() => buildMovementsParams({ dataInicio: '', dataFim: '' }))).toHaveLength(2);
  });
});

describe('buildStatementParams', () => {
  it('conta_id e unico, sem colchetes', () => {
    const params = buildStatementParams({ ...PERIODO, contaId: 11 });

    expect(params.get('conta_id')).toBe('11');
    expect(params.has('conta_id[]')).toBe(false);
  });

  it.each([0, -3, 1.5])('recusa conta_id %p', (contaId) => {
    expect(problemas(() => buildStatementParams({ ...PERIODO, contaId }))).toHaveLength(1);
  });
});

describe('buildInvoicesParams', () => {
  it('monta situacao, operacao e razao social', () => {
    const params = buildInvoicesParams({
      ...PERIODO,
      razaoSocialIds: [155],
      situacao: 'cancelada',
      operacao: 'saida',
    });

    expect(params.get('situacao')).toBe('cancelada');
    expect(params.get('operacao')).toBe('saida');
    expect(params.getAll('razao_social_id[]')).toEqual(['155']);
  });

  it.each([
    ['situacao', { situacao: 'rejeitada' }],
    ['operacao', { operacao: 'devolucao' }],
  ])('recusa %s desconhecida (rejeitadas/denegadas nem existem na API)', (_nome, filtro) => {
    expect(
      problemas(() => buildInvoicesParams({ ...PERIODO, ...(filtro as object) })),
    ).toHaveLength(1);
  });
});

describe('buildPeopleParams', () => {
  it('apara espacos da busca', () => {
    expect(buildPeopleParams({ busca: '  agro  ' }).get('busca')).toBe('agro');
  });

  it.each([
    ['curta demais', 'a'],
    ['so espacos', '   '],
    ['longa demais', 'a'.repeat(101)],
    ['com caractere de controle', 'ab\u0000cd'],
    ['com quebra de linha', 'ab\ncd'],
  ])('recusa busca %s', (_nome, busca) => {
    expect(problemas(() => buildPeopleParams({ busca }))).toHaveLength(1);
  });

  it('a mensagem NAO repete o termo buscado (pode ser CPF/CNPJ)', () => {
    const erro = problemas(() => buildPeopleParams({ busca: 'x' }));

    expect(JSON.stringify(erro)).not.toContain('"x"');
  });
});

describe('buildMeParams', () => {
  it('nao tem parametro nenhum', () => {
    expect(buildMeParams().toString()).toBe('');
  });
});
