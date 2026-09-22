import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { api, type RoleName, type User, type UserPage } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission, Permission } from '../../auth/permissions';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pagination } from '../../components/Pagination';
import { StatusLabel } from '../../components/StatusLabel';
import { ROLE_LABELS } from '../../roles';
import { userCapabilities } from './capabilities';
import { formatDate } from './format';

const PAGE_SIZE = 20;

const LAST_ADMIN_MESSAGE =
  'Operação recusada: o sistema precisa manter ao menos um administrador ativo.';

type Outcome =
  | { ok: true; page: UserPage; assignable: RoleName[] }
  | { ok: false; message: string };

type PendingAction = { kind: 'deactivate'; user: User } | { kind: 'role'; user: User; role: RoleName | '' };

export function UsersPage(): ReactNode {
  const { user: me, token, logout } = useAuth();
  const location = useLocation();

  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  // O resultado guarda a chave da consulta que o produziu: enquanto a chave
  // atual nao tem resultado, a tela esta carregando.
  const requestKey = `${page}:${reloads}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const [notice, setNotice] = useState<string | null>(
    () => (location.state as { notice?: string } | null)?.notice ?? null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const handleError = useCallback(
    (error: unknown): string => {
      if (isSessionExpired(error)) {
        void logout();
      }
      return describeApiError(error, { conflict: LAST_ADMIN_MESSAGE });
    },
    [logout],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    Promise.all([api.users.list(token, page, PAGE_SIZE), api.users.assignableRoles(token)])
      .then(([userPage, assignable]) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, page: userPage, assignable } });
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

  const closeDialog = useCallback(() => {
    setPending(null);
  }, []);

  if (!me || !token) {
    return null;
  }
  const authToken = token;

  async function run(action: () => Promise<User>, success: (user: User) => string): Promise<void> {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      const updated = await action();
      setNotice(success(updated));
      setReloads((count) => count + 1);
    } catch (error) {
      setActionError(handleError(error));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function activate(target: User): void {
    void run(
      () => api.users.setStatus(authToken, target.id, true),
      (updated) => `Usuário ${updated.nome} ativado.`,
    );
  }

  function confirmPending(): void {
    if (pending?.kind === 'deactivate') {
      void run(
        () => api.users.setStatus(authToken, pending.user.id, false),
        (updated) => `Usuário ${updated.nome} desativado.`,
      );
    } else if (pending?.kind === 'role' && pending.role !== '') {
      const role = pending.role;
      void run(
        () => api.users.setRole(authToken, pending.user.id, role),
        (updated) => `Perfil de ${updated.nome} alterado para ${ROLE_LABELS[updated.role]}.`,
      );
    }
  }

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Usuários</h1>
          <p className="muted">Pessoas com acesso ao VastaFlow.</p>
        </div>
        {hasPermission(me, Permission.UsersCreate) && (
          <Link to="/users/novo" className="button">
            Novo usuário
          </Link>
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
          Carregando usuários…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar os usuários. {outcome.message}</p>
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
        <p className="card muted">Nenhum usuário encontrado.</p>
      )}

      {outcome?.ok && outcome.page.items.length > 0 && (
        <>
          <div className="card table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">E-mail</th>
                  <th scope="col">Perfil</th>
                  <th scope="col">Status</th>
                  <th scope="col">Criado em</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {outcome.page.items.map((target) => {
                  const can = userCapabilities(me, target, outcome.assignable);
                  return (
                    <tr key={target.id}>
                      <td>{target.nome}</td>
                      <td>{target.email}</td>
                      <td>
                        <span className="badge">{ROLE_LABELS[target.role]}</span>
                      </td>
                      <td>
                        <StatusLabel ativo={target.ativo} />
                      </td>
                      <td>{formatDate(target.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <Link to={`/users/${target.id}`} className="button button-secondary button-small">
                            Ver
                          </Link>
                          {can.edit && (
                            <Link
                              to={`/users/${target.id}/editar`}
                              className="button button-secondary button-small"
                            >
                              Editar
                            </Link>
                          )}
                          {can.toggleStatus &&
                            (target.ativo ? (
                              <button
                                type="button"
                                className="button button-secondary button-small"
                                disabled={busy}
                                onClick={() => {
                                  setPending({ kind: 'deactivate', user: target });
                                }}
                              >
                                Desativar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="button button-secondary button-small"
                                disabled={busy}
                                onClick={() => {
                                  activate(target);
                                }}
                              >
                                Ativar
                              </button>
                            ))}
                          {can.changeRole && (
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              disabled={busy}
                              onClick={() => {
                                setPending({ kind: 'role', user: target, role: '' });
                              }}
                            >
                              Alterar perfil
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={outcome.page.page}
            total={outcome.page.total}
            limit={outcome.page.limit}
            onChange={setPage}
            label={{ singular: 'usuário', plural: 'usuários' }}
          />
        </>
      )}

      {pending?.kind === 'deactivate' && (
        <ConfirmDialog
          title="Desativar usuário?"
          confirmLabel="Desativar"
          danger
          busy={busy}
          onConfirm={confirmPending}
          onCancel={closeDialog}
        >
          <p>
            <strong>{pending.user.nome}</strong> ({pending.user.email}) perderá o acesso imediatamente,
            inclusive nas sessões já abertas. Você pode reativá-lo depois.
          </p>
        </ConfirmDialog>
      )}

      {pending?.kind === 'role' && outcome?.ok && (
        <ConfirmDialog
          title="Alterar perfil"
          confirmLabel="Salvar perfil"
          busy={busy}
          confirmDisabled={pending.role === ''}
          onConfirm={confirmPending}
          onCancel={closeDialog}
        >
          <p>
            Perfil atual de <strong>{pending.user.nome}</strong>: {ROLE_LABELS[pending.user.role]}.
          </p>
          <label className="field">
            <span>Novo perfil</span>
            <select
              value={pending.role}
              onChange={(event) => {
                setPending({ ...pending, role: event.target.value as RoleName | '' });
              }}
            >
              <option value="">Selecione…</option>
              {outcome.assignable
                .filter((role) => role !== pending.user.role)
                .map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
            </select>
          </label>
        </ConfirmDialog>
      )}
    </AppShell>
  );
}
