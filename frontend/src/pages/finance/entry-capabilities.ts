import type { FinancialEntry, FinancialEntryStatus, User } from '../../api/client';
import { hasPermission, Permission } from '../../auth/permissions';

/** Campos que a edicao (`PATCH /finance/entries/:id`) alcanca. */
export type EditableField = 'tipo' | 'descricao' | 'valor' | 'data' | 'categoria' | 'observacao';

const TODOS_OS_CAMPOS: readonly EditableField[] = [
  'tipo',
  'descricao',
  'valor',
  'data',
  'categoria',
  'observacao',
];

/**
 * Campos congelados em cada status.
 *
 * Espelha `entry-status.policy.ts` do backend, que continua sendo a autoridade:
 * mesmo que a interface deixe um campo aberto por engano, o servidor recusa a
 * alteracao com 409. Isto existe para a tela nao oferecer uma acao que vai
 * falhar - bloquear o campo e melhor do que deixar digitar e recusar depois.
 *
 * - `PENDENTE`: nada congelado, o lancamento ainda e uma previsao;
 * - `PAGO`: `tipo`, `valor` e `data` viraram fato consumado. Os descritivos
 *   seguem editaveis, para corrigir um texto sem apagar o fato;
 * - `CANCELADO`: nada muda. Estado terminal tambem para a edicao.
 */
const IMMUTABLE_FIELDS: Record<FinancialEntryStatus, readonly EditableField[]> = {
  PENDENTE: [],
  PAGO: ['tipo', 'valor', 'data'],
  CANCELADO: TODOS_OS_CAMPOS,
};

export function isFieldLocked(status: FinancialEntryStatus, field: EditableField): boolean {
  return IMMUTABLE_FIELDS[status].includes(field);
}

/** `true` quando o status congela o lancamento inteiro. */
export function isFrozen(status: FinancialEntryStatus): boolean {
  return IMMUTABLE_FIELDS[status].length === TODOS_OS_CAMPOS.length;
}

/**
 * Transicoes permitidas, espelhando `ALLOWED_TRANSITIONS` do backend.
 *
 * `CANCELADO` e terminal e `PAGO -> PENDENTE` nao existe: "despagar" apagaria o
 * fato de que o lancamento foi pago.
 */
const ALLOWED_TRANSITIONS: Record<FinancialEntryStatus, readonly FinancialEntryStatus[]> = {
  PENDENTE: ['PAGO', 'CANCELADO'],
  PAGO: ['CANCELADO'],
  CANCELADO: [],
};

export function allowedTransitions(
  status: FinancialEntryStatus,
): readonly FinancialEntryStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export interface EntryCapabilities {
  /** Ha algum campo editavel E o usuario tem `finance:update`. */
  edit: boolean;
  /** Destinos de status que a interface pode oferecer. Vazio = nenhuma acao. */
  transitions: readonly FinancialEntryStatus[];
}

/**
 * O que a interface oferece para este lancamento, combinando as permissoes do
 * usuario com o status do registro.
 *
 * Esconder um botao aqui nao protege nada: o backend checa a permissao e a
 * regra de status de novo em cada requisicao.
 */
export function entryCapabilities(user: User | null, entry: FinancialEntry): EntryCapabilities {
  return {
    edit: hasPermission(user, Permission.FinanceUpdate) && !isFrozen(entry.status),
    transitions: hasPermission(user, Permission.FinanceStatus)
      ? allowedTransitions(entry.status)
      : [],
  };
}
