import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError, NetworkError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/**
 * Mensagens proprias em vez de repassar a do servidor: o texto da API e tecnico
 * e nao foi escrito para o usuario final.
 */
function describeLoginError(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return 'Informe um e-mail válido e a senha.';
      case 401:
        return 'E-mail ou senha incorretos.';
      case 403:
        return 'Este usuário está inativo. Fale com o administrador.';
    }
  }
  return 'Não foi possível entrar agora. Tente novamente em instantes.';
}

export function LoginPage(): ReactNode {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), senha);
      await navigate(from, { replace: true });
    } catch (caught) {
      setError(describeLoginError(caught));
      setSubmitting(false);
    }
  }

  return (
    <main className="center-screen">
      <form className="card login-card" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <h1 className="brand">VastaFlow</h1>
        <p className="muted">Entre com sua conta para continuar.</p>

        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            name="senha"
            autoComplete="current-password"
            value={senha}
            onChange={(event) => {
              setSenha(event.target.value);
            }}
            required
          />
        </label>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button" disabled={submitting || !email || !senha}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
