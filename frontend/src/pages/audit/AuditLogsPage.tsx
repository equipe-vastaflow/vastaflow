import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, type AuditLogPage } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { Pagination } from '../../components/Pagination';
import { AuditLogsTable } from './AuditLogsTable';

const PAGE_SIZE = 20;

type Outcome = { ok: true; page: AuditLogPage } | { ok: false; message: string };

/**
 * Historico completo de auditoria.
 *
 * Consome `GET /audit-logs`, que e paginado no backend: a tela pede uma pagina
 * por vez e usa o `total` devolvido para saber quantas existem. Nada e contado
 * nem fatiado no frontend.
 */
export function AuditLogsPage(): ReactNode {
  const { token, logout } = useAuth();

  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  // O resultado guarda a chave da consulta que o produziu: enquanto a chave
  // atual nao tem resultado, a tela esta carregando (mesmo padrao das outras telas).
  const requestKey = `${page}:${reloads}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const handleError = useCallback(
    (error: unknown): string => {
      if (isSessionExpired(error)) {
        void logout();
      }
      return describeApiError(error);
    },
    [logout],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    api.auditLogs
      .list(token, page, PAGE_SIZE)
      .then((auditPage) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, page: auditPage } });
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

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Auditoria</h1>
          <p className="muted">Histórico completo de eventos registrados pelo sistema.</p>
        </div>
        <Link to="/dashboard" className="button button-secondary">
          Voltar ao dashboard
        </Link>
      </div>

      {loading && (
        <p className="muted" aria-busy="true">
          Carregando eventos…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar os eventos. {outcome.message}</p>
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
            ? 'Nenhum evento registrado ainda. As ações do sistema aparecem aqui conforme acontecem.'
            : 'Nenhum evento nesta página.'}
        </p>
      )}

      {outcome?.ok && outcome.page.items.length > 0 && (
        <>
          <AuditLogsTable eventos={outcome.page.items} />
          <Pagination
            page={outcome.page.page}
            total={outcome.page.total}
            limit={outcome.page.limit}
            onChange={setPage}
            label={{ singular: 'evento', plural: 'eventos' }}
          />
        </>
      )}
    </AppShell>
  );
}
