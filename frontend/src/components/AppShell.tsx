import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { hasPermission, Permission } from '../auth/permissions';
import { useNotifications } from '../notifications/NotificationsContext';

/** Barra superior e navegacao das paginas autenticadas. */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }): ReactNode {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
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
            <NavLink to="/notifications" className="nav-link">
              Notificações
              {/* O selo so aparece quando ha algo por ler, e o texto do
                  aria-label diz o numero - a cor nao e a unica pista. */}
              {unreadCount > 0 && (
                <span className="nav-badge" aria-label={`${unreadCount} não lidas`}>
                  {unreadCount}
                </span>
              )}
            </NavLink>
            {hasPermission(user, Permission.UsersRead) && (
              <NavLink to="/users" className="nav-link">
                Usuários
              </NavLink>
            )}
            {hasPermission(user, Permission.FinanceRead) && (
              <NavLink to="/finance" className="nav-link">
                Financeiro
              </NavLink>
            )}
            {hasPermission(user, Permission.DocumentsRead) && (
              <NavLink to="/documents" className="nav-link">
                Documentos
              </NavLink>
            )}
            {hasPermission(user, Permission.AuditRead) && (
              <NavLink to="/audit-logs" className="nav-link">
                Auditoria
              </NavLink>
            )}
            {hasPermission(user, Permission.SettingsRead) && (
              <NavLink to="/settings" className="nav-link">
                Configurações
              </NavLink>
            )}
            <NavLink to="/profile" className="nav-link">
              Meu perfil
            </NavLink>
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
