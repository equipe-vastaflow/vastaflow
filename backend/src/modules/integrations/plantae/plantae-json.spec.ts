import { PlantaeApiError } from './plantae-errors';
import { JsonObject, parsePlantaeJson, PlantaeNumber } from './plantae-json';

function root(text: string): JsonObject {
  return JsonObject.from(parsePlantaeJson(text), '');
}

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

describe('parsePlantaeJson: precisao dos numeros', () => {
  it('preserva o TEXTO do numero, inclusive zeros finais', () => {
    const obj = root('{"valor":8337.10,"inteiro":42,"zero":0.00}');

    expect(obj.decimal('valor')).toBe('8337.10');
    expect(obj.decimal('zero')).toBe('0.00');
    expect(obj.int('inteiro')).toBe(42);
  });

  it('nao passa por ponto flutuante: 0.1 + 0.2 nao existe aqui', () => {
    expect(root('{"v":0.30000000000000004}').decimal('v')).toBe('0.30000000000000004');
    // Um `number` perderia a cauda: 1234567890123456.78 vira 1234567890123456.8
    expect(root('{"v":1234567890123456.78}').decimal('v')).toBe('1234567890123456.78');
  });

  it('nao arredonda valor com mais de 2 casas (o exemplo da colecao tem 15+)', () => {
    expect(root('{"v":8337.985532718963}').decimal('v')).toBe('8337.985532718963');
  });

  it('aceita negativo', () => {
    expect(root('{"v":-12.50}').decimal('v')).toBe('-12.50');
  });

  it.each(['1e3', '1E3', '1.5e-7', '2e+2'])('recusa notacao cientifica (%s)', (texto) => {
    const erro = falha(() => root(`{"v":${texto}}`).decimal('v'));

    expect(erro.kind).toBe('invalid-response');
    expect(erro.detail.where).toBe('v [decimal]');
  });

  it('numero e DEVOLVIDO como PlantaeNumber pelo parse (nunca como number)', () => {
    const raw = parsePlantaeJson('{"v":1.5}') as { v: unknown };

    expect(raw.v).toBeInstanceOf(PlantaeNumber);
    expect(typeof raw.v).not.toBe('number');
  });

  it('texto que nao e JSON vira invalid-response sem repetir o conteudo', () => {
    const erro = falha(() => parsePlantaeJson('{"cpf":"000.000.000-00", quebrado'));

    expect(erro.kind).toBe('invalid-response');
    expect(erro.message).not.toContain('000.000.000-00');
  });
});

describe('JsonObject: tipos', () => {
  it('le cada tipo documentado', () => {
    const obj = root(
      '{"s":"a","ns":null,"i":7,"ni":null,"d":1.10,"nd":null,"b":true,"dt":"2026-09-03",' +
        '"ndt":null,"ts":"2026-09-03T10:15:30-03:00","l":"X","arr":[{"a":1}],"sarr":["x","y"]}',
    );

    expect(obj.string('s')).toBe('a');
    expect(obj.nullableString('ns')).toBeNull();
    expect(obj.int('i')).toBe(7);
    expect(obj.nullableInt('ni')).toBeNull();
    expect(obj.decimal('d')).toBe('1.10');
    expect(obj.nullableDecimal('nd')).toBeNull();
    expect(obj.boolean('b')).toBe(true);
    expect(obj.date('dt')).toBe('2026-09-03');
    expect(obj.nullableDate('ndt')).toBeNull();
    expect(obj.dateTime('ts')).toBe('2026-09-03T10:15:30-03:00');
    expect(obj.looseNumber('l')).toBe('X');
    expect(obj.objectArray('arr')).toHaveLength(1);
    expect(obj.stringArray('sarr')).toEqual(['x', 'y']);
  });

  it('null permanece null: nunca vira 0, vazio ou data', () => {
    const obj = root('{"v":null}');

    expect(obj.nullableDecimal('v')).toBeNull();
    expect(obj.nullableString('v')).toBeNull();
    expect(obj.nullableDate('v')).toBeNull();
    expect(obj.nullableInt('v')).toBeNull();
  });

  it('chave AUSENTE e violacao (a colecao diz que campo sem valor vem null e nunca some)', () => {
    const erro = falha(() => root('{"a":1}').nullableString('b'));

    expect(erro.detail.where).toBe('b [ausente]');
  });

  it.each([
    ['texto onde se espera inteiro', '{"v":"7"}', (o: JsonObject) => o.int('v'), 'inteiro'],
    ['decimal onde se espera inteiro', '{"v":7.5}', (o: JsonObject) => o.int('v'), 'inteiro'],
    ['inteiro inseguro', '{"v":9007199254740993}', (o: JsonObject) => o.int('v'), 'inteiro'],
    ['texto onde se espera decimal', '{"v":"7.5"}', (o: JsonObject) => o.decimal('v'), 'decimal'],
    ['null onde nao pode', '{"v":null}', (o: JsonObject) => o.string('v'), 'texto'],
    ['numero onde se espera texto', '{"v":1}', (o: JsonObject) => o.string('v'), 'texto'],
    [
      'texto onde se espera booleano',
      '{"v":"true"}',
      (o: JsonObject) => o.boolean('v'),
      'booleano',
    ],
    ['data impossivel', '{"v":"2026-02-30"}', (o: JsonObject) => o.date('v'), 'data'],
    ['data com hora', '{"v":"2026-09-03T00:00:00Z"}', (o: JsonObject) => o.date('v'), 'data'],
    [
      'data-hora sem fuso',
      '{"v":"2026-09-03T10:15:30"}',
      (o: JsonObject) => o.dateTime('v'),
      'data-hora',
    ],
    [
      'data-hora com dia impossivel',
      '{"v":"2026-02-30T10:00:00Z"}',
      (o: JsonObject) => o.dateTime('v'),
      'data-hora',
    ],
    [
      'data-hora com hora 25',
      '{"v":"2026-09-03T25:00:00Z"}',
      (o: JsonObject) => o.dateTime('v'),
      'data-hora',
    ],
    ['objeto onde se espera lista', '{"v":{}}', (o: JsonObject) => o.objectArray('v'), 'lista'],
    ['lista onde se espera objeto', '{"v":[]}', (o: JsonObject) => o.object('v'), 'objeto'],
    ['item que nao e texto', '{"v":["a",1]}', (o: JsonObject) => o.stringArray('v'), 'texto'],
    ['numero com letra', '{"v":true}', (o: JsonObject) => o.looseNumber('v'), 'numero ou texto'],
  ])('recusa %s', (_nome, texto, ler, esperado) => {
    const erro = falha(() => ler(root(texto)));

    expect(erro.kind).toBe('invalid-response');
    expect(erro.detail.where).toContain(`[${esperado}`);
  });

  it('a violacao aponta o CAMINHO completo, inclusive indices de lista', () => {
    const obj = root('{"data":[{"x":1},{"x":2,"y":{"z":"nao-e-numero"}}]}');
    const item = obj.objectArray('data')[1];

    const erro = falha(() => item?.object('y').int('z'));

    expect(erro.detail.where).toBe('data[1].y.z [inteiro]');
  });

  it('a violacao NUNCA repete o valor recebido', () => {
    const erro = falha(() => root('{"cpf_cnpj":123456789}').string('cpf_cnpj'));
    const outro = falha(() => root('{"nome":"Fulano de Tal 000.000.000-00"}').int('nome'));

    expect(erro.message).not.toContain('123456789');
    expect(outro.message).not.toContain('Fulano');
    expect(outro.message).not.toContain('000.000.000-00');
    expect(JSON.stringify(outro.detail)).not.toContain('Fulano');
  });

  it('raiz que nao e objeto', () => {
    expect(falha(() => JsonObject.from([], '').string('x')).kind).toBe('invalid-response');
    expect(falha(() => JsonObject.from(null, 'raiz')).detail.where).toBe('raiz [objeto]');
    expect(falha(() => JsonObject.from('texto', '')).kind).toBe('invalid-response');
  });

  it('looseNumber: numero vira texto, texto continua texto', () => {
    expect(root('{"v":5101}').looseNumber('v')).toBe('5101');
    expect(root('{"v":"005101"}').looseNumber('v')).toBe('005101');
    expect(root('{"v":null}').looseNumber('v')).toBeNull();
  });

  it('campo __proto__ no JSON nao contamina nada', () => {
    const obj = root('{"__proto__":{"admin":true},"a":1}');

    expect(obj.int('a')).toBe(1);
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });
});

describe('JsonObject.opaque', () => {
  it('preserva estrutura sem forma documentada', () => {
    const obj = root('{"v":{"a":[1,2.5,"x",null,true],"b":{"c":"d"}}}');

    expect(obj.opaque('v')).toEqual({ a: [1, 2.5, 'x', null, true], b: { c: 'd' } });
  });

  it('numero que o JS nao representa com fidelidade fica como TEXTO', () => {
    expect(root('{"v":0.30000000000000004}').opaque('v')).toBe(0.30000000000000004);
    expect(root('{"v":12.10}').opaque('v')).toBe('12.10');
  });

  it('null continua null', () => {
    expect(root('{"v":null}').opaque('v')).toBeNull();
  });

  it('recusa profundidade excessiva', () => {
    const fundo = `{"v":${'['.repeat(10)}1${']'.repeat(10)}}`;

    expect(falha(() => root(fundo).opaque('v')).kind).toBe('invalid-response');
  });
});

describe('codigos', () => {
  it('numericCode e textCode', () => {
    const obj = root(
      '{"a":{"codigo":7,"descricao":"x"},"b":{"codigo":"C","descricao":null},"n":null}',
    );

    expect(obj.numericCode('a')).toEqual({ codigo: 7, descricao: 'x' });
    expect(obj.textCode('b')).toEqual({ codigo: 'C', descricao: null });
    expect(obj.nullableNumericCode('n')).toBeNull();
    expect(obj.nullableTextCode('n')).toBeNull();
  });

  it('codigo do tipo errado e violacao', () => {
    const erro = falha(() => root('{"a":{"codigo":"7","descricao":"x"}}').numericCode('a'));

    expect(erro.detail.where).toBe('a.codigo [inteiro]');
  });
});
