import type { ValueTransformer } from 'typeorm';

/**
 * Maior tamanho de arquivo representavel sem perder precisao.
 *
 * `Number.MAX_SAFE_INTEGER` sao ~9 PB. Nenhum arquivo chega perto, entao
 * trafegar o tamanho como `number` e seguro - e evita espalhar `bigint` pela
 * API, pelos DTOs e pelo frontend, onde `JSON.stringify` nem suporta.
 */
export const SIZE_MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Uniformiza a leitura da coluna `bigint`.
 *
 * Os drivers divergem e o TypeORM nao normaliza: o MySQL devolve `bigint` como
 * STRING (`"1048576"`), outros como number. Sem tratar, o tipo do JSON da API
 * mudaria conforme o banco - foi exatamente o que aconteceu com `DECIMAL` no
 * financeiro, e a solucao aqui e a mesma do `moneyTransformer`.
 */
export const sizeTransformer: ValueTransformer = {
  /** Escrita: inteiro, sempre. Tamanho de arquivo nao tem fracao. */
  to: (value: number): number => Math.trunc(value),

  from: (value: unknown): number => {
    if (typeof value === 'number') {
      return value;
    }
    const numero = Number(value);
    return Number.isFinite(numero) ? numero : 0;
  },
};
