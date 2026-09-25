import type { NotificationType } from '../../api/client';

/**
 * Nome do tipo na tela.
 *
 * O texto é sempre exibido: a cor reforça, mas nunca é a única pista do tipo.
 */
export const TYPE_LABELS: Record<NotificationType, string> = {
  INFO: 'Informação',
  SUCCESS: 'Sucesso',
  WARNING: 'Atenção',
  ERROR: 'Erro',
};

/** Classe do selo de tipo, no mesmo padrão dos selos do financeiro. */
export const TYPE_BADGE_CLASS: Record<NotificationType, string> = {
  INFO: 'badge badge-info',
  SUCCESS: 'badge badge-success',
  WARNING: 'badge badge-warning',
  ERROR: 'badge badge-error',
};
