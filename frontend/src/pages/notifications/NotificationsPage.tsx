import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type NotificationPage } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { Pagination } from '../../components/Pagination';
import { useNotifications } from '../../notifications/NotificationsContext';
import { formatDateTime } from '../users/format';
import { NotificationTypeBadge } from './NotificationTypeBadge';

const PAGE_SIZE = 20;

const NOT_FOUND = 'Notificação não encontrada. Ela pode já ter sido removida.';

type Outcome = { ok: true; page: NotificationPage } | { ok: false; message: string };

/**
 * Notificações internas do usuário.
 *
 * Consome `GET /notifications`, paginado no backend: a tela pede uma página por
 * vez e usa o `total` devolvido. Nada é contado, ordenado nem fatiado aqui - o
 * backend já entrega as não lidas primeiro.
 *
 * O contador de não lidas vem do `NotificationsContext`, que é o mesmo do menu:
 * uma única consulta a `unread-count`, relida depois de cada ação. Não há
 * atualização automática - nenhum polling, WebSocket ou SSE nesta etapa.
 */
export function NotificationsPage(): ReactNode {
  const { token, logout } = useAuth();
  const { unreadCount, refreshUnreadCount } = useNotifications();

  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  // O resultado guarda a chave da consulta que o produziu: enquanto a chave
  // atual não tem resultado, a tela está carregando (mesmo padrão das outras).
  const requestKey = `${page}:${reloads}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Id em andamento, ou `'todas'`. Enquanto houver um, nenhum botão responde. */
  const [busy, setBusy] = useState<string | null>(null);

  const handleError = useCallback(
    (error: unknown): string => {
      if (isSessionExpired(error)) {
        void logout();
      }
      return describeApiError(error, { notFound: NOT_FOUND });
    },
    [logout],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    api.notifications
      .list(token, page, PAGE_SIZE)
      .then((notificationPage) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, page: notificationPage } });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: false, message: handleError(error) } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, requestKey, handleError]);

  // Ao entrar na tela o contador é relido: ele pode estar velho se outra aba,
  // ou outro caminho, já leu alguma notificação.
  useEffect(() => {
    void refreshUnreadCount();
  }, [refreshUnreadCount]);

  if (!token) {
    return null;
  }
  const authToken = token;

  /** Recarrega a página atual sem recarregar o navegador, e relê o contador. */
  function reload(): void {
    setReloads((count) => count + 1);
    void refreshUnreadCount();
  }

  function marcarLida(id: string, titulo: string): void {
    // `busy` desabilita todos os botões, então um clique repetido - no mesmo
    // botão ou em outro - não dispara uma segunda requisição.
    if (busy !== null) {
      return;
    }
    setBusy(id);
    setNotice(null);
    setActionError(null);
    api.notifications
      .markAsRead(authToken, id)
      .then(() => {
        setNotice(`"${titulo}" marcada como lida.`);
        reload();
      })
      .catch((error: unknown) => {
        setActionError(handleError(error));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  function marcarTodas(): void {
    if (busy !== null) {
      return;
    }
    setBusy('todas');
    setNotice(null);
    setActionError(null);
    api.notifications
      .markAllAsRead(authToken)
      .then(({ atualizadas }) => {
        setNotice(
          atualizadas === 1
            ? '1 notificação marcada como lida.'
            : `${atualizadas} notificações marcadas como lidas.`,
        );
        reload();
      })
      .catch((error: unknown) => {
        setActionError(handleError(error));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Notificações</h1>
          <p className="muted">
            {unreadCount === 0
              ? 'Nenhuma notificação por ler.'
              : unreadCount === 1
                ? '1 notificação por ler.'
                : `${unreadCount} notificações por ler.`}
          </p>
        </div>
        {unreadCount > 0 && (
          <button type="button" className="button" disabled={busy !== null} onClick={marcarTodas}>
            {busy === 'todas' ? 'Marcando…' : 'Marcar todas como lidas'}
          </button>
        )}
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="alert" role="alert">
          {actionError}
        </p>
      )}

      {loading && (
        <p className="muted" aria-busy="true">
          Carregando notificações…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar as notificações. {outcome.message}</p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setReloads((count) => count + 1);
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {outcome?.ok && outcome.page.items.length === 0 && (
        <p className="card muted">
          {outcome.page.total === 0
            ? 'Nenhuma notificação ainda. Os avisos do sistema aparecem aqui conforme acontecem.'
            : 'Nenhuma notificação nesta página.'}
        </p>
      )}

      {outcome?.ok && outcome.page.items.length > 0 && (
        <>
          <ul className="notification-list">
            {outcome.page.items.map((item) => (
              <li
                key={item.id}
                className={item.lida ? 'card notification' : 'card notification notification-nova'}
              >
                <div className="notification-head">
                  <h2 className="notification-title">{item.titulo}</h2>
                  <NotificationTypeBadge tipo={item.tipo} />
                  {/* O estado aparece escrito, e não só pela cor da borda. */}
                  <span className={item.lida ? 'muted' : 'badge badge-nova'}>
                    {item.lida ? 'Lida' : 'Não lida'}
                  </span>
                </div>
                <p className="notification-message">{item.mensagem}</p>
                <div className="notification-foot">
                  <span className="muted">{formatDateTime(item.createdAt)}</span>
                  {!item.lida && (
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={busy !== null}
                      onClick={() => {
                        marcarLida(item.id, item.titulo);
                      }}
                    >
                      {busy === item.id ? 'Marcando…' : 'Marcar como lida'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <Pagination
            page={outcome.page.page}
            total={outcome.page.total}
            limit={outcome.page.limit}
            onChange={setPage}
            label={{ singular: 'notificação', plural: 'notificações' }}
          />
        </>
      )}
    </AppShell>
  );
}
