import {
  parseSettingValue,
  readSettingValue,
  serializeSettingValue,
  SETTING_NUMBER_MAX,
  SETTING_NUMBER_MIN,
  SETTING_VALUE_MAX_LENGTH,
} from './setting-value';
import { SystemSettingType } from './system-setting.enums';

const { String: STRING, Number: NUMBER, Boolean: BOOLEAN } = SystemSettingType;

/** Atalho: so o valor aceito, ou `null` quando a entrada foi recusada. */
function aceito(tipo: SystemSettingType, raw: unknown): unknown {
  const resultado = parseSettingValue(tipo, raw);
  return resultado.ok ? resultado.value : null;
}

function recusa(tipo: SystemSettingType, raw: unknown): string {
  const resultado = parseSettingValue(tipo, raw);
  if (resultado.ok) {
    throw new Error(`esperava recusa, mas o valor foi aceito: ${JSON.stringify(resultado.value)}`);
  }
  return resultado.erro;
}

describe('parseSettingValue', () => {
  describe('STRING', () => {
    it('aceita texto e remove espacos nas pontas', () => {
      expect(aceito(STRING, 'VastaFlow')).toBe('VastaFlow');
      expect(aceito(STRING, '  VastaFlow  ')).toBe('VastaFlow');
    });

    it('recusa texto vazio ou so com espacos', () => {
      expect(recusa(STRING, '')).toContain('vazio');
      expect(recusa(STRING, '   ')).toContain('vazio');
    });

    it(`recusa texto maior que ${SETTING_VALUE_MAX_LENGTH} caracteres`, () => {
      expect(aceito(STRING, 'a'.repeat(SETTING_VALUE_MAX_LENGTH))).toHaveLength(
        SETTING_VALUE_MAX_LENGTH,
      );
      expect(recusa(STRING, 'a'.repeat(SETTING_VALUE_MAX_LENGTH + 1))).toContain('no maximo');
    });

    it.each([
      ['numero', 20],
      ['booleano', true],
      ['nulo', null],
      ['objeto', { valor: 'x' }],
      ['lista', ['x']],
    ])('recusa %s numa configuracao de texto', (_nome, raw) => {
      expect(recusa(STRING, raw)).toContain('deve ser um texto');
    });
  });

  describe('NUMBER', () => {
    it('aceita inteiro e decimal', () => {
      expect(aceito(NUMBER, 20)).toBe(20);
      expect(aceito(NUMBER, 1.5)).toBe(1.5);
      expect(aceito(NUMBER, 0)).toBe(0);
      expect(aceito(NUMBER, -3)).toBe(-3);
    });

    it('recusa NaN e Infinity', () => {
      expect(recusa(NUMBER, Number.NaN)).toContain('finito');
      expect(recusa(NUMBER, Number.POSITIVE_INFINITY)).toContain('finito');
      expect(recusa(NUMBER, Number.NEGATIVE_INFINITY)).toContain('finito');
    });

    it('respeita os limites da faixa aceita', () => {
      expect(aceito(NUMBER, SETTING_NUMBER_MAX)).toBe(SETTING_NUMBER_MAX);
      expect(aceito(NUMBER, SETTING_NUMBER_MIN)).toBe(SETTING_NUMBER_MIN);
      expect(recusa(NUMBER, SETTING_NUMBER_MAX + 1)).toContain('entre');
      expect(recusa(NUMBER, SETTING_NUMBER_MIN - 1)).toContain('entre');
    });

    it('NAO converte texto numerico: "20" nao vira 20', () => {
      expect(recusa(NUMBER, '20')).toContain('deve ser um numero');
    });

    it.each([
      ['booleano', true],
      ['nulo', null],
      ['objeto', {}],
    ])('recusa %s numa configuracao numerica', (_nome, raw) => {
      expect(recusa(NUMBER, raw)).toContain('deve ser um numero');
    });
  });

  describe('BOOLEAN', () => {
    it('aceita true e false', () => {
      expect(aceito(BOOLEAN, true)).toBe(true);
      expect(aceito(BOOLEAN, false)).toBe(false);
    });

    /**
     * A armadilha classica: `Boolean("false") === true`. A string nunca e
     * convertida - e recusada.
     */
    it.each([
      ['"true"', 'true'],
      ['"false"', 'false'],
      ['1', 1],
      ['0', 0],
      ['nulo', null],
    ])('recusa %s sem nenhuma coercao', (_nome, raw) => {
      expect(recusa(BOOLEAN, raw)).toContain('true ou false');
    });
  });

  it('a mensagem de recusa nao repete o valor recebido', () => {
    // A mensagem volta ao cliente e pode ir para o log: diz o TIPO que chegou,
    // nunca o conteudo.
    expect(recusa(NUMBER, 'senha-secreta-do-usuario')).not.toContain('senha-secreta');
    expect(recusa(NUMBER, 'senha-secreta-do-usuario')).toContain('string');
  });
});

describe('serializeSettingValue', () => {
  it.each([
    ['texto', 'VastaFlow', 'VastaFlow'],
    ['inteiro', 20, '20'],
    ['decimal', 1.5, '1.5'],
    ['verdadeiro', true, 'true'],
    ['falso', false, 'false'],
  ])('grava %s como texto', (_nome, value, esperado) => {
    expect(serializeSettingValue(value)).toBe(esperado);
  });
});

describe('readSettingValue', () => {
  it.each([
    ['STRING', STRING, 'VastaFlow', 'VastaFlow'],
    ['NUMBER inteiro', NUMBER, '20', 20],
    ['NUMBER decimal', NUMBER, '1.5', 1.5],
    ['BOOLEAN verdadeiro', BOOLEAN, 'true', true],
    ['BOOLEAN falso', BOOLEAN, 'false', false],
  ])('le %s de volta no tipo declarado', (_nome, tipo, stored, esperado) => {
    expect(readSettingValue(tipo, stored)).toBe(esperado);
  });

  it('ida e volta preserva o valor em todos os tipos', () => {
    const casos: [SystemSettingType, string | number | boolean][] = [
      [STRING, 'VastaFlow'],
      [NUMBER, 20],
      [NUMBER, -0.25],
      [BOOLEAN, true],
      [BOOLEAN, false],
    ];

    for (const [tipo, value] of casos) {
      expect(readSettingValue(tipo, serializeSettingValue(value))).toBe(value);
    }
  });

  /**
   * So acontece se a linha for alterada por fora (SQL manual): a API valida
   * tudo que escreve. Falhar alto e melhor do que devolver um valor adivinhado
   * a quem pediu `getNumber`.
   */
  it.each([
    ['NUMBER com texto', NUMBER, 'vinte'],
    ['NUMBER vazio', NUMBER, ''],
    ['BOOLEAN com "sim"', BOOLEAN, 'sim'],
    ['BOOLEAN com "1"', BOOLEAN, '1'],
  ])('%s gravado por fora do sistema falha alto', (_nome, tipo, stored) => {
    expect(() => readSettingValue(tipo, stored)).toThrow(/invalido no banco/);
  });
});
