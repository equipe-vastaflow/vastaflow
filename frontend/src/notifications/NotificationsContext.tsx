import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface NotificationsContextValue {
  /** Quantas notificações o usuário tem por ler. Zero quando não há sessão. */
  unreadCount: number;
  /** Relê o contador no servidor. Chamado depois de marcar algo como lido. */
  refreshUnreadCount: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Contador de não lidas, compartilhado pelo menu e pela tela de notificações.
 *
 * Uma única consulta a `GET /notifications/unread-count` - nunca uma por
 * notificação. O valor é lido quando a sessão muda e relido depois de cada ação
 * de marcar como lida; **não há polling, WebSocket nem SSE** nesta etapa, então
 * o número só muda em resposta a algo que o próprio usuário fez.
 *
 * Falha na consulta não derruba nada: o contador simplesmente fica em zero e o
 * menu não mostra o selo. Ele é informativo - a tela de notificações continua
 * acessível e é ela que reporta erro de verdade.
 */
export function NotificationsProvider({ children }: { children: ReactNode }): ReactNode {
  const { token } = useAuth();
  const [lidoDoServidor, setLidoDoServidor] = useState(0);

  // Primeira leitura (e releitura quando a sessão troca). Mesmo formato de
  // efeito das telas: a promessa resolve e só então o estado muda.
  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    api.notifications
      .unreadCount(token)
      .then(({ count }) => {
        if (!cancelled) {
          setLidoDoServidor(count);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLidoDoServidor(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Releitura sob demanda, depois de marcar uma ou todas como lidas. */
  const refreshUnreadCount = useCallback(async (): Promise<void> => {
    if (!token) {
      return;
    }
    try {
      const { count } = await api.notifications.unreadCount(token);
      setLidoDoServidor(count);
    } catch {
      setLidoDoServidor(0);
    }
  }, [token]);

  // Sem sessão o contador é zero por derivação, e não por um efeito que zera o
  // estado: um selo não pode sobreviver ao logout nem por um instante.
  const unreadCount = token ? lidoDoServidor : 0;

  return (
    <NotificationsContext.Provider value={{ unreadCount, refreshUnreadCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error('useNotifications precisa estar dentro de NotificationsProvider');
  }
  return value;
}
