import type { ReactNode } from 'react';
import type { NotificationType } from '../../api/client';
import { TYPE_BADGE_CLASS, TYPE_LABELS } from './notification-format';

/**
 * Tipo da notificação, sempre escrito por extenso.
 *
 * A cor apenas reforça o que o texto já diz - nunca é a única pista. Quem não
 * distingue as cores, ou usa leitor de tela, continua lendo "Informação",
 * "Sucesso", "Atenção" ou "Erro" normalmente. Mesmo critério dos selos do
 * financeiro.
 */
export function NotificationTypeBadge({ tipo }: { tipo: NotificationType }): ReactNode {
  return <span className={TYPE_BADGE_CLASS[tipo]}>{TYPE_LABELS[tipo]}</span>;
}
