import { MONEY_MAX, MONEY_MIN, moneyTransformer } from './money.transformer';

describe('moneyTransformer', () => {
  describe('leitura (from) - uniformiza o que cada driver devolve', () => {
    it('MySQL devolve string: vira number', () => {
      expect(moneyTransformer.from('1500.00')).toBe(1500);
      expect(moneyTransformer.from('0.01')).toBe(0.01);
      expect(moneyTransformer.from('1234.56')).toBe(1234.56);
    });

    it('Oracle e SQLite devolvem number: passa direto', () => {
      expect(moneyTransformer.from(1500)).toBe(1500);
      expect(moneyTransformer.from(1234.56)).toBe(1234.56);
    });

    it('sempre devolve number, qualquer que seja o driver', () => {
      for (const bruto of ['99.90', 99.9]) {
        expect(typeof moneyTransformer.from(bruto)).toBe('number');
      }
    });

    it('preserva o maior valor representavel sem perder precisao', () => {
      expect(moneyTransformer.from(String(MONEY_MAX))).toBe(MONEY_MAX);
    });

    it('nulo continua nulo', () => {
      expect(moneyTransformer.from(null)).toBeNull();
      expect(moneyTransformer.from(undefined)).toBeNull();
    });
  });

  describe('escrita (to)', () => {
    it('grava number, nao string - coluna NUMBER do Oracle nao depende de conversao implicita', () => {
      expect(typeof moneyTransformer.to(1500)).toBe('number');
    });

    it('arredonda para 2 casas, eliminando residuo de ponto flutuante', () => {
      // 10.1 * 3 === 30.299999999999997
      expect(moneyTransformer.to(10.1 * 3)).toBe(30.3);
      expect(moneyTransformer.to(0.1 + 0.2)).toBe(0.3);
    });

    it('mantem valores ja com 2 casas', () => {
      expect(moneyTransformer.to(MONEY_MIN)).toBe(0.01);
      expect(moneyTransformer.to(1234.56)).toBe(1234.56);
      expect(moneyTransformer.to(MONEY_MAX)).toBe(MONEY_MAX);
    });

    it('nulo continua nulo', () => {
      expect(moneyTransformer.to(null)).toBeNull();
      expect(moneyTransformer.to(undefined)).toBeNull();
    });
  });

  it('ida e volta preserva o valor, independentemente do driver', () => {
    for (const valor of [MONEY_MIN, 0.99, 1500, 1234.56, MONEY_MAX]) {
      const gravado = moneyTransformer.to(valor) as number;
      // MySQL devolveria a string; Oracle/SQLite, o number.
      expect(moneyTransformer.from(gravado.toFixed(2))).toBe(valor);
      expect(moneyTransformer.from(gravado)).toBe(valor);
    }
  });
});
