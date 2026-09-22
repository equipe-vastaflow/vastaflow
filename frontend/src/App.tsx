import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Permission } from './auth/permissions';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { RequirePermission } from './auth/RequirePermission';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { UserDetailPage } from './pages/users/UserDetailPage';
import { UserFormPage } from './pages/users/UserFormPage';
import { UsersPage } from './pages/users/UsersPage';

/** Rotas da aplicacao. O roteador (`BrowserRouter`) fica em `main.tsx` para permitir testes com `MemoryRouter`. */
export function App(): ReactNode {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Administracao de usuarios. A permissao e checada de novo pelo backend. */}
        <Route element={<RequirePermission permission={Permission.UsersRead} />}>
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:id" element={<UserDetailPage />} />
        </Route>
        <Route element={<RequirePermission permission={Permission.UsersCreate} />}>
          <Route path="/users/novo" element={<UserFormPage key="novo" />} />
        </Route>
        <Route element={<RequirePermission permission={Permission.UsersUpdate} />}>
          <Route path="/users/:id/editar" element={<UserFormPage key="editar" />} />
        </Route>
      </Route>

      {/* Qualquer outro endereco cai no dashboard, que por sua vez exige login. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
