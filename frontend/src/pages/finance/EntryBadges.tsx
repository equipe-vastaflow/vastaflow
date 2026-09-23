import type { ReactNode } from 'react';
import type { FinancialEntryStatus, FinancialEntryType } from '../../api/client';
import { STATUS_LABELS, TYPE_LABELS } from './finance-format';

/**
 * Tipo e status sempre aparecem escritos por extenso.
 *
 * A cor apenas reforca o que o texto ja diz - nunca e a unica pista. Quem nao
 * distingue as cores, ou usa leitor de tela, continua lendo "Receita",
 * "Despesa", "Pendente", "Pago" ou "Cancelado" normalmente.
 */
export function EntryTypeBadge({ tipo }: { tipo: FinancialEntryType }): ReactNode {
  return (
    <span className={tipo === 'RECEITA' ? 'badge badge-receita' : 'badge badge-despesa'}>
      {TYPE_LABELS[tipo]}
    </span>
  );
}

const STATUS_CLASS: Record<FinancialEntryStatus, string> = {
  PENDENTE: 'badge badge-pendente',
  PAGO: 'badge badge-pago',
  CANCELADO: 'badge badge-cancelado',
};

export function EntryStatusBadge({ status }: { status: FinancialEntryStatus }): ReactNode {
  return <span className={STATUS_CLASS[status]}>{STATUS_LABELS[status]}</span>;
}
