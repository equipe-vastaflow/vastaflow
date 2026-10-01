import type { IdentityChannel, LinkRequestStatus } from '../../api/client';

/**
 * Nome do canal na tela.
 *
 * Só o Telegram: é o único canal que o backend conhece. Não há entrada para
 * WhatsApp, e-mail ou qualquer outro - eles não existem no contrato.
 */
export const CHANNEL_LABELS: Record<IdentityChannel, string> = {
  telegram: 'Telegram',
};

/** Situação da solicitação, escrita por extenso - nunca só por cor. */
export const LINK_REQUEST_STATUS_LABELS: Record<LinkRequestStatus, string> = {
  PENDENTE: 'Pendente',
  CONFIRMADA: 'Confirmada',
  CANCELADA: 'Cancelada',
  EXPIRADA: 'Expirada',
};

/**
 * `true` quando o prazo do código já passou.
 *
 * É uma leitura de `expiraEm`, não um status novo: o backend mantém a
 * solicitação como `PENDENTE` até que uma nova seja pedida, e é ele quem recusa
 * a confirmação de um código vencido. A tela apenas informa o que a data diz.
 */
export function isExpired(expiraEm: string, agora = Date.now()): boolean {
  return new Date(expiraEm).getTime() <= agora;
}
