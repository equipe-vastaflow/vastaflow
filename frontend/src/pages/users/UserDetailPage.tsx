import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api, type RoleName, type User } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { StatusLabel } from '../../components/StatusLabel';
import { ROLE_LABELS } from '../../roles';
import { userCapabilities } from './capabilities';
import { formatDateTime } from './format';

type Loaded =
  | { key: string; state: 'error'; message: string }
  | { key: string; state: 'ready'; user: User; assignable: RoleName[] };

/** Visualizacao de um usuario (`/users/:id`). */
export function UserDetailPage(): ReactNode {
  const { id = '' } = useParams();
  const { user: me, token, logout } = useAuth();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    Promise.all([api.users.get(token, id), api.users.assignableRoles(token)])
      .then(([user, assignable]) => {
        if (!cancelled) {
          setLoaded({ key: id, state: 'ready', user, assignable });
        }
      })
      .catch((error: unknown) => {
        if (isSessionExpired(error)) {
          void logout();
        }
        if (!cancelled) {
          setLoaded({ key: id, state: 'error', message: describeApiError(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, id, logout]);

  if (!me) {
    return null;
  }

  // Resultado de outro id (navegacao entre usuarios) conta como carregando.
  const current = loaded?.key === id ? loaded : null;

  return (
    <AppShell>
      <p>
        <Link to="/users">← Usuários</Link>
      </p>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {!current && (
        <p className="muted" aria-busy="true">
          Carregando…
        </p>
      )}

      {current?.state === 'error' && (
        <p className="alert" role="alert">
          {current.message}
        </p>
      )}

      {current?.state === 'ready' && (
        <>
          <div className="page-header">
            <h1>{current.user.nome}</h1>
            {userCapabilities(me, current.user, current.assignable).edit && (
              <Link to={`/users/${current.user.id}/editar`} className="button">
                Editar
              </Link>
            )}
          </div>

          <dl className="card info-grid">
            <div>
              <dt>Nome</dt>
              <dd>{current.user.nome}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{current.user.email}</dd>
            </div>
            <div>
              <dt>Perfil</dt>
              <dd>
                <span className="badge">{ROLE_LABELS[current.user.role]}</span>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusLabel ativo={current.user.ativo} />
              </dd>
            </div>
            <div>
              <dt>Criado em</dt>
              <dd>{formatDateTime(current.user.createdAt)}</dd>
            </div>
            <div>
              <dt>Atualizado em</dt>
              <dd>{formatDateTime(current.user.updatedAt)}</dd>
            </div>
          </dl>
        </>
      )}
    </AppShell>
  );
}
