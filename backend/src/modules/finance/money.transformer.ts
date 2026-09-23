import type { ValueTransformer } from 'typeorm';

/** Casas decimais de um valor monetario. */
export const MONEY_SCALE = 2;

/** Total de digitos da coluna: 13 inteiros + 2 decimais. */
export const MONEY_PRECISION = 15;

/** Maior valor representavel em DECIMAL(15,2). */
export const MONEY_MAX = 9_999_999_999_999.99;

/** Menor lancamento aceito: zero e negativo sao recusados. */
export const MONEY_MIN = 0.01;

/**
 * Normaliza o valor monetario na fronteira com o banco.
 *
 * **Por que existe.** Os drivers nao concordam sobre o tipo de leitura de uma
 * coluna DECIMAL, e o TypeORM nao normaliza isso (ao contrario do que faz com
 * `date` e `boolean`):
 *
 * | Driver          | `SELECT valor` devolve |
 * | --------------- | ---------------------- |
 * | MySQL (mysql2)  | `string` - "1500.00"   |
 * | Oracle          | `number`               |
 * | SQLite (testes) | `number`               |
 *
 * Sem este transformer, o mesmo codigo receberia `string` em producao e
 * `number` nos testes - divergencia que so apareceria em producao. Com ele, o
 * dominio e a API veem sempre `number`.
 *
 * **Na escrita** o valor e arredondado para 2 casas antes de ir ao banco, o que
 * elimina residuo de ponto flutuante (ex.: `10.1 * 3 = 30.299999999999997`).
 * Um `number` e enviado, e nao uma string: em coluna NUMBER do Oracle a string
 * dependeria de conversao implicita.
 *
 * O intervalo aceito (`MONEY_MIN` a `MONEY_MAX`) cabe com folga no inteiro
 * exato do JavaScript, entao a conversao de e para centavos nao perde precisao.
 */
export const moneyTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return Math.round(value * 100) / 100;
  },

  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return typeof value === 'number' ? value : Number(value);
  },
};
