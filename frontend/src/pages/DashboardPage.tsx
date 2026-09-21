import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { RoleName } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { formatRemaining } from './format-remaining';

const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: 'Administrador',
  GESTOR: 'Gestor',
  OPERADOR: 'Operador',
  USUARIO: 'Usuário',
};

export function DashboardPage(): ReactNode {
  const { user, expiresAt, logout } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());

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

  async function handleLogout(): Promise<void> {
    await logout();
    await navigate('/login', { replace: true });
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <span className="brand">VastaFlow</span>
        <button type="button" className="button button-secondary" onClick={() => void handleLogout()}>
          Sair
        </button>
      </header>

      <main className="content">
        <h1>Olá, {user.nome}</h1>
        <p className="muted">Você está autenticado no VastaFlow.</p>

        <dl className="card info-grid">
          <div>
            <dt>Nome</dt>
            <dd>{user.nome}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Perfil</dt>
            <dd>
              <span className="badge">{ROLE_LABELS[user.role]}</span>{' '}
              <span className="muted">({user.role})</span>
            </dd>
          </div>
          <div>
            <dt>Status da sessão</dt>
            <dd>
              <span className="status-dot" aria-hidden="true" />
              Ativa
              <span className="muted"> · expira em {formatRemaining(expiresAt - now)}</span>
            </dd>
          </div>
        </dl>
      </main>
    </div>
  );
}
