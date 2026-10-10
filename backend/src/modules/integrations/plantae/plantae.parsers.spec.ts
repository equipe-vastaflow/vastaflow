import {
  accountJson,
  entryJson,
  invoiceJson,
  legalEntityJson,
  listJson,
  ME_JSON,
  movementJson,
  personJson,
} from '../../../../test/support/plantae-fixtures';
import { PlantaeApiError } from './plantae-errors';
import { parsePlantaeJson } from './plantae-json';
import {
  parseAccounts,
  parseEntries,
  parseIntegration,
  parseIssuedInvoices,
  parseLegalEntities,
  parseMovements,
  parsePeople,
  parseStatement,
} from './plantae.parsers';

function falha(fn: () => unknown): PlantaeApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PlantaeApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('deveria ter falhado');
}

const parse = (text: string): unknown => parsePlantaeJson(text);

describe('parseIntegration (/me)', () => {
  it('le a integracao, a organizacao e os escopos', () => {
    expect(parseIntegration(parse(ME_JSON))).toEqual({
      id: 5421,
      nome: 'Integracao Ficticia',
      organizacao_id: 7432,
      scopes: ['financial-entries:read', 'issued-invoices:read'],
    });
  });

  it('aceita lista de escopos vazia', () => {
    const body = '{"data":{"id":1,"nome":"x","organizacao_id":2,"scopes":[]}}';

    expect(parseIntegration(parse(body)).scopes).toEqual([]);
  });

  it.each([
    ['sem data', '{}'],
    ['data que e lista', '{"data":[]}'],
    ['id em texto', '{"data":{"id":"1","nome":"x","organizacao_id":2,"scopes":[]}}'],
    ['scopes que nao e lista', '{"data":{"id":1,"nome":"x","organizacao_id":2,"scopes":"a"}}'],
    ['escopo que nao e texto', '{"data":{"id":1,"nome":"x","organizacao_id":2,"scopes":[1]}}'],
  ])('recusa %s', (_nome, body) => {
    expect(falha(() => parseIntegration(parse(body))).kind).toBe('invalid-response');
  });
});

describe('parseEntries (/financial/entries)', () => {
  const page = (): ReturnType<typeof parseEntries> =>
    parseEntries(parse(listJson([entryJson(482), entryJson(483)], { nextCursor: 'abc123' })));

  it('le as parcelas', () => {
    const { items } = page();

    expect(items).toHaveLength(2);
    expect(items[0]?.parcela_id).toBe(482);
    expect(items[0]?.titulo.titulo_id).toBe(1293);
    expect(items[0]?.pessoa?.pessoa_id).toBe(6990);
  });

  it('valores monetarios sao TEXTO decimal exato, nunca number', () => {
    const entry = page().items[0];

    expect(entry?.valor).toBe('8337.10');
    expect(entry?.total_pago).toBe('0.00');
    expect(entry?.saldo_atual).toBe('8337.10');
    expect(entry?.titulo.valor_total).toBe('25011.30');
    expect(entry?.rateio[0]?.percentual).toBe('100.00');
    expect(typeof entry?.valor).toBe('string');
  });

  it('null permanece null (nada vira 0 nem texto vazio)', () => {
    const entry = page().items[0];

    expect(entry?.total_juros).toBeNull();
    expect(entry?.total_multa).toBeNull();
    expect(entry?.data_ult_pagto).toBeNull();
    expect(entry?.titulo.observacao).toBeNull();
    expect(entry?.rateio[0]?.conta_analitica_sequencia).toBeNull();
  });

  it('status SUBSTITUIDA (2) continua 2, sem virar cancelada', () => {
    expect(page().items[0]?.status).toEqual({ codigo: 2, descricao: 'Substituida' });
  });

  it.each([0, 1, 2])('preserva o codigo de status %i como veio', (codigo) => {
    const { items } = parseEntries(parse(listJson([entryJson(1, { statusCode: codigo })])));

    expect(items[0]?.status.codigo).toBe(codigo);
  });

  it('a moeda do titulo e preservada (valores NAO sao assumidos em reais)', () => {
    expect(page().items[0]?.titulo.moeda).toEqual({ moeda_id: 1, nome: 'Real', simbolo: 'R$' });
  });

  it('campo sem forma documentada (razao_social) e preservado sem interpretacao', () => {
    expect(page().items[0]?.razao_social).toBeNull();
  });

  it('campos extras nao documentados NAO passam adiante', () => {
    const comExtra = entryJson(1).replace(
      '"parcela_id":1,',
      '"parcela_id":1,"campo_novo":"segredo",',
    );
    const { items } = parseEntries(parse(listJson([comExtra])));

    expect(JSON.stringify(items)).not.toContain('segredo');
  });

  it('valor invalido derruba a resposta, apontando o caminho (sem o valor)', () => {
    const quebrado = entryJson(1, { valor: '"R$ 8.337,10"' });

    const erro = falha(() => parseEntries(parse(listJson([entryJson(5), quebrado]))));

    expect(erro.detail.where).toBe('data[1].valor [decimal]');
    expect(erro.message).not.toContain('8.337');
  });

  it('chave ausente derruba a resposta', () => {
    const semStatus = entryJson(1).replace(/"status":\{[^}]*\},/, '');

    const erro = falha(() => parseEntries(parse(listJson([semStatus]))));

    expect(erro.detail.where).toBe('data[0].status [ausente]');
  });

  it('data de vencimento impossivel e recusada', () => {
    const ruim = entryJson(1).replace('"data_vencto":"2026-09-10"', '"data_vencto":"2026-02-30"');

    expect(falha(() => parseEntries(parse(listJson([ruim])))).detail.where).toBe(
      'data[0].data_vencto [data]',
    );
  });

  it('lista vazia e valida', () => {
    expect(parseEntries(parse(listJson([]))).items).toEqual([]);
  });

  it('data que nao e lista e recusado', () => {
    expect(falha(() => parseEntries(parse('{"data":{}}'))).kind).toBe('invalid-response');
  });
});

describe('paginacao crua', () => {
  it('le meta.next_cursor e links.next', () => {
    const { pagination } = parseEntries(parse(listJson([], { nextCursor: 'cur123' })));

    expect(pagination.nextCursor).toBe('cur123');
    expect(pagination.nextLink).toContain('cursor=cur123');
    expect(pagination).toMatchObject({ hasLinks: true, hasMeta: true, perPage: 100 });
  });

  it('ultima pagina: next_cursor null', () => {
    const { pagination } = parseEntries(parse(listJson([], { nextCursor: null })));

    expect(pagination).toMatchObject({ nextCursor: null, nextLink: null });
  });

  it('resposta SEM links e SEM meta (como o exemplo de /people): nao informada', () => {
    const { pagination } = parsePeople(
      parse(listJson([personJson()], { withLinks: false, withMeta: false })),
    );

    expect(pagination).toMatchObject({ hasLinks: false, hasMeta: false, nextCursor: null });
  });

  it('so meta (como o exemplo do extrato)', () => {
    const { pagination } = parsePeople(
      parse(listJson([personJson()], { withLinks: false, nextCursor: 'zzz' })),
    );

    expect(pagination).toMatchObject({ hasLinks: false, hasMeta: true, nextCursor: 'zzz' });
  });

  it('meta sem next_cursor e violacao (nao vira "acabou")', () => {
    const body = '{"data":[],"meta":{"path":"x","per_page":100}}';

    expect(falha(() => parsePeople(parse(body))).detail.where).toBe('meta.next_cursor [ausente]');
  });

  it('o cursor e devolvido EXATAMENTE como veio, sem decodificar nem alterar', () => {
    const opaco = 'eyJpZCI6MTIzLCJfcG9pbnRzX3RvX25leHRfaXRlbXMiOnRydWV9';

    const { pagination } = parsePeople(parse(listJson([], { nextCursor: opaco })));

    expect(pagination.nextCursor).toBe(opaco);
  });
});

describe('parseAccounts', () => {
  it('le contas, com e sem banco', () => {
    const semBanco =
      '{"conta_id":9,"nome":"Caixa","tipo":{"codigo":1,"descricao":"Caixa"},"banco":null,' +
      '"agencia":null,"numero_conta":null,"conta_bancaria_id":null}';

    const { items } = parseAccounts(parse(listJson([accountJson(), semBanco])));

    expect(items[0]?.banco).toEqual({ banco_id: 5085, nome: 'Banco Ficticio' });
    expect(items[0]?.tipo.codigo).toBe(2);
    expect(items[1]?.banco).toBeNull();
    expect(items[1]?.numero_conta).toBeNull();
  });

  it('NAO inventa saldo: a conta nao tem campo de saldo', () => {
    const { items } = parseAccounts(parse(listJson([accountJson()])));

    expect(Object.keys(items[0] ?? {})).not.toContain('saldo');
  });
});

describe('parseMovements', () => {
  it('le credito e debito', () => {
    const { items } = parseMovements(
      parse(listJson([movementJson(1, { natureza: 'C' }), movementJson(2, { natureza: 'D' })])),
    );

    expect(items.map((m) => m.natureza.codigo)).toEqual(['C', 'D']);
  });

  it('natureza fora de C/D e recusada', () => {
    const erro = falha(() => parseMovements(parse(listJson([movementJson(1, { natureza: 'X' })]))));

    expect(erro.detail.where).toBe('data[0].natureza.codigo [C ou D]');
  });

  it('valor exato e saldo da linha', () => {
    const { items } = parseMovements(parse(listJson([movementJson(1, { valor: '1503.20' })])));

    expect(items[0]?.valor).toBe('1503.20');
    expect(items[0]?.saldo).toBe('9000.80');
  });

  it('numero_cheque numerico vira texto (preserva zeros se vier como texto)', () => {
    const numerico = parseMovements(parse(listJson([movementJson(1, { numeroCheque: '6229' })])));
    const texto = parseMovements(parse(listJson([movementJson(1, { numeroCheque: '"000123"' })])));

    expect(numerico.items[0]?.numero_cheque).toBe('6229');
    expect(texto.items[0]?.numero_cheque).toBe('000123');
  });

  it('conciliado precisa ser booleano', () => {
    const ruim = movementJson(1).replace('"conciliado":false', '"conciliado":"nao"');

    expect(falha(() => parseMovements(parse(listJson([ruim])))).detail.where).toBe(
      'data[0].conciliado [booleano]',
    );
  });
});

describe('parseStatement (/financial/account-statement)', () => {
  const body = (extra: string): string =>
    listJson([movementJson(1)], {
      withLinks: false,
      endpoint: 'financial/account-statement',
      metaExtra: extra,
    });

  it('le os saldos do periodo, como texto exato', () => {
    const result = parseStatement(parse(body('"saldo_anterior":2605.14,"saldo_final":3470.10')));

    expect(result.saldoAnterior).toBe('2605.14');
    expect(result.saldoFinal).toBe('3470.10');
    expect(result.items).toHaveLength(1);
  });

  it('saldo negativo e preservado', () => {
    const result = parseStatement(parse(body('"saldo_anterior":-10.00,"saldo_final":-5.50')));

    expect(result.saldoAnterior).toBe('-10.00');
  });

  it('sem os saldos no meta, falha (nao calcula a partir das linhas)', () => {
    const erro = falha(() => parseStatement(parse(body('"outro":1'))));

    expect(erro.detail.where).toBe('meta.saldo_anterior [ausente]');
  });

  it('sem meta nenhum, falha', () => {
    const semMeta = listJson([movementJson(1)], { withLinks: false, withMeta: false });

    expect(falha(() => parseStatement(parse(semMeta))).detail.where).toBe('meta [ausente]');
  });
});

describe('parseIssuedInvoices (NF-e modelo 55)', () => {
  it('le a nota, emitente, destinatario, totais e itens', () => {
    const { items } = parseIssuedInvoices(
      parse(listJson([invoiceJson()], { endpoint: 'fiscal/issued-invoices' })),
    );
    const nota = items[0];

    expect(nota?.modelo).toBe('55');
    expect(nota?.situacao).toEqual({ codigo: '1', descricao: 'Autorizada' });
    expect(nota?.operacao?.codigo).toBe('1');
    expect(nota?.emitente.razao_social_id).toBe(155);
    expect(nota?.destinatario.pessoa_id).toBe(2775);
    expect(nota?.totais.total_nota).toBe('8460.66');
    expect(nota?.totais.icms).toBeNull();
    expect(nota?.itens[0]?.quantidade).toBe('10.5000');
    expect(nota?.itens[0]?.cfop).toBe('5101');
    expect(nota?.dh_emissao).toBe('2026-09-03T10:15:30-03:00');
  });

  it('resposta da SEFAZ e cancelamento sao opacos (so null na colecao)', () => {
    const { items } = parseIssuedInvoices(parse(listJson([invoiceJson()])));

    expect(items[0]?.resposta_sefaz).toBeNull();
    expect(items[0]?.cancelamento).toBeNull();
  });

  it('nao ha campo de XML nem de DANFE no contrato', () => {
    const { items } = parseIssuedInvoices(parse(listJson([invoiceJson()])));

    expect(Object.keys(items[0] ?? {}).join(' ')).not.toMatch(/xml|danfe|pdf/i);
  });

  it('data-hora de emissao invalida e recusada', () => {
    const ruim = invoiceJson().replace('2026-09-03T10:15:30-03:00', '03/09/2026 10:15');

    expect(falha(() => parseIssuedInvoices(parse(listJson([ruim])))).detail.where).toBe(
      'data[0].dh_emissao [data-hora]',
    );
  });
});

describe('parseLegalEntities e parsePeople', () => {
  it('le razoes sociais', () => {
    const { items } = parseLegalEntities(parse(listJson([legalEntityJson()])));

    expect(items[0]).toEqual({
      razao_social_id: 2187,
      razao_social: 'Razao Social Ficticia',
      inscricao_estadual: null,
      cpf_cnpj: '00.000.000/0000-00',
      fazenda: null,
    });
  });

  it('le pessoas, com campos nulos', () => {
    const semNome =
      '{"pessoa_id":5362,"nome":null,"razao_social":"Empresa Ficticia","tipo_pessoa":null,"cpf_cnpj":null}';

    const { items } = parsePeople(
      parse(listJson([personJson(), semNome], { withLinks: false, withMeta: false })),
    );

    expect(items[0]?.tipo_pessoa).toBe('F');
    expect(items[1]).toEqual({
      pessoa_id: 5362,
      nome: null,
      razao_social: 'Empresa Ficticia',
      tipo_pessoa: null,
      cpf_cnpj: null,
    });
  });
});

describe('formatos observados na homologacao REAL (Fase 4.2), reproduzidos com dados ficticios', () => {
  describe('movimentacoes SEM `saldo` (a listagem real nao envia a chave)', () => {
    it('a listagem aceita a chave ausente e devolve saldo null = "nao informado"', () => {
      const { items } = parseMovements(
        parse(listJson([movementJson(1, { semSaldo: true }), movementJson(2, { semSaldo: true })])),
      );

      expect(items).toHaveLength(2);
      expect(items.every((m) => m.saldo === null)).toBe(true);
      expect(items[0]?.valor).toBe('1503.20');
      expect(items[0]?.natureza.codigo).toBe('D');
    });

    it('com `saldo` presente, continua devolvendo o valor exato', () => {
      const { items } = parseMovements(parse(listJson([movementJson(1)])));

      expect(items[0]?.saldo).toBe('9000.80');
    });

    it('`saldo: null` explicito continua null', () => {
      const comNull = movementJson(1).replace('"saldo":9000.80', '"saldo":null');

      expect(parseMovements(parse(listJson([comNull]))).items[0]?.saldo).toBeNull();
    });

    it('a tolerancia e SO para `saldo`: qualquer outra chave ausente continua sendo violacao', () => {
      const semConciliado = movementJson(1, { semSaldo: true }).replace('"conciliado":false,', '');

      expect(falha(() => parseMovements(parse(listJson([semConciliado])))).detail.where).toBe(
        'data[0].conciliado [ausente]',
      );
    });

    it('o EXTRATO continua exigindo `saldo` em cada linha (nao validado no ambiente real)', () => {
      const corpo = listJson([movementJson(1, { semSaldo: true })], {
        withLinks: false,
        metaExtra: '"saldo_anterior":10.00,"saldo_final":20.00',
      });

      expect(falha(() => parseStatement(parse(corpo))).detail.where).toBe(
        'data[0].saldo [ausente]',
      );
    });
  });

  describe('dinheiro sem casas decimais', () => {
    const inteiro = entryJson(1)
      .replace('"valor":8337.10', '"valor":1500')
      .replace('"total_pago":0.00', '"total_pago":0')
      .replace('"saldo_atual":8337.10', '"saldo_atual":1500')
      .replace('"percentual":100.00,"valor":8337.10', '"percentual":100,"valor":1500');

    it('valores inteiros ficam como texto inteiro: a escala NAO e fixa em 2 casas', () => {
      const entry = parseEntries(parse(listJson([inteiro]))).items[0];

      expect(entry?.valor).toBe('1500');
      expect(entry?.total_pago).toBe('0');
      expect(entry?.saldo_atual).toBe('1500');
      expect(entry?.rateio[0]?.percentual).toBe('100');
      expect(entry?.rateio[0]?.valor).toBe('1500');
    });

    it('nao ha normalizacao: 1500 nao vira "1500.00"', () => {
      expect(parseEntries(parse(listJson([inteiro]))).items[0]?.valor).not.toBe('1500.00');
    });
  });

  describe('objetos com forma que a colecao nao mostrava', () => {
    it('`razao_social` da parcela como objeto e preservado sem interpretar', () => {
      const comObjeto = entryJson(1).replace(
        '"razao_social":null,"rateio"',
        '"razao_social":{"razao_social_id":3,"razao_social":"Razao Ficticia","inscricao_estadual":"123"},"rateio"',
      );

      expect(parseEntries(parse(listJson([comObjeto]))).items[0]?.razao_social).toEqual({
        razao_social_id: 3,
        razao_social: 'Razao Ficticia',
        inscricao_estadual: '123',
      });
    });

    it('`fazenda` da razao social como objeto e preservada sem interpretar', () => {
      const comFazenda = legalEntityJson(7).replace(
        '"fazenda":null',
        '"fazenda":{"fazenda_id":9,"nome":"Fazenda Ficticia"}',
      );

      expect(parseLegalEntities(parse(listJson([comFazenda]))).items[0]?.fazenda).toEqual({
        fazenda_id: 9,
        nome: 'Fazenda Ficticia',
      });
    });
  });
});
