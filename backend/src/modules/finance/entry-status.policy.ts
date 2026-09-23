import { FinancialEntryStatus } from './financial-entry.enums';

/**
 * Transicoes permitidas de status.
 *
 * Regra minima e deliberada - nao ha workflow contabil aqui:
 *
 * - `PENDENTE` -> `PAGO` ou `CANCELADO`;
 * - `PAGO` -> `CANCELADO` (estorno de um pagamento registrado por engano);
 * - `CANCELADO` e **terminal**: um lancamento cancelado nao volta atras. Para
 *   retomar, cria-se um lancamento novo, preservando o historico do anterior;
 * - `PAGO` -> `PENDENTE` e recusado: "despagar" um lancamento apagaria o fato
 *   de que ele foi pago, sem deixar rastro no proprio registro.
 *
 * Repetir o status atual nao e transicao: e tratado como operacao sem efeito
 * pelo `FinanceService`, que responde normalmente e nao audita - mesmo criterio
 * ja usado ao ativar um usuario que ja esta ativo.
 */
const ALLOWED_TRANSITIONS: Record<FinancialEntryStatus, readonly FinancialEntryStatus[]> = {
  [FinancialEntryStatus.Pendente]: [FinancialEntryStatus.Pago, FinancialEntryStatus.Cancelado],
  [FinancialEntryStatus.Pago]: [FinancialEntryStatus.Cancelado],
  [FinancialEntryStatus.Cancelado]: [],
};

export function canTransition(from: FinancialEntryStatus, to: FinancialEntryStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Campos do lancamento que a edicao (`PATCH /finance/entries/:id`) alcanca. */
export type EditableEntryField =
  'tipo' | 'descricao' | 'valor' | 'data' | 'categoria' | 'observacao';

const TODOS_OS_CAMPOS: readonly EditableEntryField[] = [
  'tipo',
  'descricao',
  'valor',
  'data',
  'categoria',
  'observacao',
];

/**
 * Campos congelados em cada status, para preservar a integridade do fato
 * financeiro ja consumado:
 *
 * - `PENDENTE`: nada congelado - o lancamento ainda e uma previsao;
 * - `PAGO`: `tipo`, `valor` e `data` viram fato consumado e nao mudam mais. Os
 *   tres respondem *o que* foi pago, quanto e quando; `tipo` em especial inverte
 *   o sinal do lancamento, entao troca-lo depois do pagamento transformaria uma
 *   saida de caixa em entrada sem que nada tivesse acontecido de fato. Os campos
 *   descritivos continuam editaveis, para corrigir um texto sem apagar o fato;
 * - `CANCELADO`: **nada** muda. E o estado terminal tambem para a edicao, pela
 *   mesma razao que nenhuma transicao sai dele: o registro esta encerrado e
 *   serve de historico. Corrigir algo apos o cancelamento significa criar um
 *   lancamento novo, preservando o anterior.
 */
const IMMUTABLE_FIELDS: Record<FinancialEntryStatus, readonly EditableEntryField[]> = {
  [FinancialEntryStatus.Pendente]: [],
  [FinancialEntryStatus.Pago]: ['tipo', 'valor', 'data'],
  [FinancialEntryStatus.Cancelado]: TODOS_OS_CAMPOS,
};

export function immutableFieldsFor(status: FinancialEntryStatus): readonly EditableEntryField[] {
  return IMMUTABLE_FIELDS[status];
}

/** `true` quando o status congela o lancamento inteiro: nenhum campo e editavel. */
export function isFrozen(status: FinancialEntryStatus): boolean {
  return IMMUTABLE_FIELDS[status].length === TODOS_OS_CAMPOS.length;
}

/**
 * Quais dos campos informados o status atual NAO permite alterar.
 *
 * Vazio significa que a edicao pode prosseguir.
 */
export function rejectedEdits(
  status: FinancialEntryStatus,
  fields: readonly string[],
): EditableEntryField[] {
  const congelados = IMMUTABLE_FIELDS[status];
  return fields.filter((field): field is EditableEntryField =>
    congelados.includes(field as EditableEntryField),
  );
}

/** Destinos validos a partir de um status, para mensagens de erro e documentacao. */
export function allowedTransitionsFrom(
  status: FinancialEntryStatus,
): readonly FinancialEntryStatus[] {
  return ALLOWED_TRANSITIONS[status];
}
