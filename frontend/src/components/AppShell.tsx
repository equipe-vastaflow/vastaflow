import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { hasPermission, Permission } from '../auth/permissions';

/** Barra superior e navegacao das paginas autenticadas. */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }): ReactNode {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    await navigate('/login', { replace: true });
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="topbar-start">
          <span className="brand">VastaFlow</span>
          <nav className="nav" aria-label="Navegação principal">
            <NavLink to="/dashboard" className="nav-link">
              Início
            </NavLink>
            {hasPermission(user, Permission.UsersRead) && (
              <NavLink to="/users" className="nav-link">
                Usuários
              </NavLink>
            )}
            {hasPermission(user, Permission.AuditRead) && (
              <NavLink to="/audit-logs" className="nav-link">
                Auditoria
              </NavLink>
            )}
          </nav>
        </div>
        <button type="button" className="button button-secondary" onClick={() => void handleLogout()}>
          Sair
        </button>
      </header>

      <main className={wide ? 'content content-wide' : 'content'}>{children}</main>
    </div>
  );
}
