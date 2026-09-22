import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { ROLE_LABELS } from '../roles';
import { formatRemaining } from './format-remaining';

export function DashboardPage(): ReactNode {
  const { user, expiresAt } = useAuth();
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

  return (
    <AppShell>
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
    </AppShell>
  );
}
