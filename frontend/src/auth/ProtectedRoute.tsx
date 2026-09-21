import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

/**
 * Barra o acesso de quem nao esta autenticado.
 *
 * Enquanto o token guardado e confirmado com o servidor (`loading`), nada
 * protegido e renderizado - nem por um instante.
 */
export function ProtectedRoute(): ReactNode {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <main className="center-screen" aria-busy="true">
        <p className="muted">Verificando sessão…</p>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
