import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type DashboardSummary } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission, Permission } from '../../auth/permissions';
import { AppShell } from '../../components/AppShell';
import { ROLE_LABELS } from '../../roles';
import { formatRemaining } from '../format-remaining';
import { AdminShortcuts, type Shortcut } from './AdminShortcuts';
import { RecentAudit } from './RecentAudit';
import { UserStatsCards } from './UserStatsCards';

type Outcome = { ok: true; summary: DashboardSummary } | { ok: false; message: string };

/**
 * Dashboard administrativo.
 *
 * Mostra apenas o que o backend devolve, e o backend devolve apenas as secoes
 * permitidas ao perfil - por isso um perfil sem permissoes ve a pagina, mas sem
 * indicadores, em vez de um erro.
 */
export function DashboardPage(): ReactNode {
  const { user, token, expiresAt, logout } = useAuth();

  const [reloads, setReloads] = useState(0);
  // O resultado guarda a chave da consulta que o produziu: enquanto a chave
  // atual nao tem resultado, a tela esta carregando (mesmo padrao da area de usuarios).
  const requestKey = String(reloads);
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
    api.dashboard
      .summary(token)
      .then((summary) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, summary } });
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
  }, [token, requestKey, handleError]);

  // Contagem regressiva da sessao.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // A rota ja e protegida; isto so satisfaz o tipo (`user` e nulo sem sessao).
  if (!user || expiresAt === null) {
    return null;
  }

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;
  const summary = outcome?.ok ? outcome.summary : null;

  const atalhos: Shortcut[] = [
    ...(hasPermission(user, Permission.UsersRead)
      ? [{ label: 'Usuários', descricao: 'Cadastro, perfis e status', to: '/users' }]
      : []),
    // Auditoria ainda nao tem tela propria. O rotulo e a descricao deixam claro
    // que o atalho apenas desce ate a secao desta pagina.
    ...(summary?.auditoria
      ? [
          {
            label: 'Auditoria recente',
            descricao: 'Ver os últimos eventos, aqui nesta página',
            to: '#auditoria',
          },
        ]
      : []),
  ];

  const semIndicadores = summary !== null && !summary.usuarios && !summary.auditoria;

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            Olá, {user.nome} · {user.email}
          </p>
        </div>
        <div className="identity">
          <span className="badge">{ROLE_LABELS[user.role]}</span>{' '}
          <span className="muted">({user.role})</span>
          <p className="muted">
            <span className="status-dot" aria-hidden="true" />
            Status da sessão: Ativa
            <span className="muted"> · expira em {formatRemaining(expiresAt - now)}</span>
          </p>
        </div>
      </div>

      {loading && (
        <p className="muted" aria-busy="true">
          Carregando indicadores…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar os indicadores. {outcome.message}</p>
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

      {semIndicadores && (
        <p className="card muted">
          Seu perfil não tem acesso a indicadores administrativos. Fale com um administrador se
          precisar de acesso.
        </p>
      )}

      {summary?.usuarios && <UserStatsCards counts={summary.usuarios} />}
      <AdminShortcuts atalhos={atalhos} />
      {summary?.auditoria && (
        <RecentAudit eventos={summary.auditoria.recentes} total={summary.auditoria.total} />
      )}
    </AppShell>
  );
}
