import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Permission } from './auth/permissions';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { NotificationsProvider } from './notifications/NotificationsContext';
import { RequirePermission } from './auth/RequirePermission';
import { AuditLogsPage } from './pages/audit/AuditLogsPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { DocumentsPage } from './pages/documents/DocumentsPage';
import { FinanceEntryDetailPage } from './pages/finance/FinanceEntryDetailPage';
import { FinanceEntryFormPage } from './pages/finance/FinanceEntryFormPage';
import { FinancePage } from './pages/finance/FinancePage';
import { FinanceReportsPage } from './pages/finance/FinanceReportsPage';
import { LoginPage } from './pages/LoginPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { UserDetailPage } from './pages/users/UserDetailPage';
import { UserFormPage } from './pages/users/UserFormPage';
import { UsersPage } from './pages/users/UsersPage';

/** Rotas da aplicacao. O roteador (`BrowserRouter`) fica em `main.tsx` para permitir testes com `MemoryRouter`. */
export function App(): ReactNode {
  return (
    // O contador de nao lidas e compartilhado pelo menu e pela tela de
    // notificacoes: uma consulta so, num lugar so.
    <NotificationsProvider>
      <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Publica, fora do `ProtectedRoute`: exigida pela Meta (app do WhatsApp). */}
      <Route path="/privacidade" element={<PrivacyPolicyPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Notificacoes do proprio usuario: sem permissao granular, como
            `/auth/me`. O backend so devolve as de quem esta autenticado. */}
        <Route path="/notifications" element={<NotificationsPage />} />

        {/* Dados pessoais do proprio usuario. Sem permissao granular pelo
            mesmo motivo: a identidade do JWT ja limita o alcance. */}
        <Route path="/profile" element={<ProfilePage />} />

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

        {/* Financeiro. Cada rota exige a permissao correspondente, e o backend
            a checa de novo em cada requisicao. */}
        <Route element={<RequirePermission permission={Permission.FinanceRead} />}>
          <Route path="/finance" element={<FinancePage />} />
          {/* Antes de `/finance/:id`, senao "relatorios" seria lido como um id.
              Relatorios e exportacao usam `finance:read`: nao existe permissao
              propria de exportacao. */}
          <Route path="/finance/relatorios" element={<FinanceReportsPage />} />
          <Route path="/finance/:id" element={<FinanceEntryDetailPage />} />
        </Route>
        <Route element={<RequirePermission permission={Permission.FinanceCreate} />}>
          <Route path="/finance/novo" element={<FinanceEntryFormPage key="novo" />} />
        </Route>
        <Route element={<RequirePermission permission={Permission.FinanceUpdate} />}>
          <Route path="/finance/:id/editar" element={<FinanceEntryFormPage key="editar" />} />
        </Route>

        {/* Documentos. Enviar exige `documents:create`, checado no backend em
            cada requisicao; a tela so esconde o botao. */}
        <Route element={<RequirePermission permission={Permission.DocumentsRead} />}>
          <Route path="/documents" element={<DocumentsPage />} />
        </Route>

        {/* Configuracoes do sistema. Hoje so o ADMIN tem `settings:read`. */}
        <Route element={<RequirePermission permission={Permission.SettingsRead} />}>
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Auditoria. O backend exige `audit:read` de novo em cada requisicao. */}
        <Route element={<RequirePermission permission={Permission.AuditRead} />}>
          <Route path="/audit-logs" element={<AuditLogsPage />} />
        </Route>
      </Route>

      {/* Qualquer outro endereco cai no dashboard, que por sua vez exige login. */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </NotificationsProvider>
  );
}
