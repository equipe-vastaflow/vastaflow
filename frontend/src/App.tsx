import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';

/** Rotas da aplicacao. O roteador (`BrowserRouter`) fica em `main.tsx` para permitir testes com `MemoryRouter`. */
export function App(): ReactNode {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>

      {/* Qualquer outro endereco cai no dashboard, que por sua vez exige login. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
