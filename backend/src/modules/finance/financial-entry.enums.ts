/**
 * Natureza do lancamento. E o `tipo` que diz se o dinheiro entra ou sai - o
 * `valor` e sempre positivo, nunca negativo.
 */
export enum FinancialEntryType {
  Receita = 'RECEITA',
  Despesa = 'DESPESA',
}

/**
 * Situacao do lancamento.
 *
 * `PENDENTE` e o estado inicial de todo lancamento. `CANCELADO` e terminal.
 * As transicoes permitidas ficam em `entry-status.policy.ts`.
 */
export enum FinancialEntryStatus {
  Pendente = 'PENDENTE',
  Pago = 'PAGO',
  Cancelado = 'CANCELADO',
}
