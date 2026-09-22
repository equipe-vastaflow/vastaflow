import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { AppShell } from '../components/AppShell';
import { useAuth } from './AuthContext';
import { hasPermission, type PermissionCode } from './permissions';

/**
 * Esconde a area de quem nao tem a permissao. Conveniencia de interface: sem a
 * permissao o backend responde 403 de qualquer forma.
 */
export function RequirePermission({ permission }: { permission: PermissionCode }): ReactNode {
  const { user } = useAuth();

  if (!hasPermission(user, permission)) {
    return (
      <AppShell>
        <h1>Acesso negado</h1>
        <p className="muted">Seu perfil não tem permissão para acessar esta área.</p>
      </AppShell>
    );
  }

  return <Outlet />;
}
