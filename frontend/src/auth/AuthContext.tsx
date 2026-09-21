import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, type User } from '../api/client';
import { clearSession, loadSession, saveSession } from './session-storage';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Instante (ms) em que o token expira; `null` sem sessao. */
  expiresAt: number | null;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface Session {
  token: string;
  expiresAt: number;
  user: User;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** `setTimeout` estoura acima de ~24,8 dias; tokens reais expiram bem antes disso. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Ao abrir/recarregar a pagina, confirma com o servidor que o token guardado
  // ainda vale (nao expirou, usuario segue ativo) antes de liberar o dashboard.
  useEffect(() => {
    let cancelled = false;
    const stored = loadSession();

    if (!stored || stored.expiresAt <= Date.now()) {
      clearSession();
      setStatus('unauthenticated');
      return;
    }

    api
      .me(stored.token)
      .then((user) => {
        if (!cancelled) {
          setSession({ token: stored.token, expiresAt: stored.expiresAt, user });
          setStatus('authenticated');
        }
      })
      .catch((error: unknown) => {
        // So descarta o token quando o servidor o recusou. Numa falha de rede
        // ele pode continuar valido; mantem para a proxima tentativa.
        if (error instanceof ApiError) {
          clearSession();
        }
        if (!cancelled) {
          setStatus('unauthenticated');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Encerra a sessao no navegador no instante em que o token expira.
  useEffect(() => {
    if (!session) {
      return;
    }
    const remaining = Math.max(0, session.expiresAt - Date.now());
    const timer = setTimeout(() => {
      clearSession();
      setSession(null);
      setStatus('unauthenticated');
    }, Math.min(remaining, MAX_TIMEOUT_MS));
    return () => {
      clearTimeout(timer);
    };
  }, [session]);

  const login = useCallback(async (email: string, senha: string): Promise<void> => {
    const response = await api.login(email, senha);
    const expiresAt = Date.now() + response.expiresIn * 1000;
    saveSession({ token: response.accessToken, expiresAt });
    setSession({ token: response.accessToken, expiresAt, user: response.user });
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const token = session?.token;
    // A sessao local e encerrada mesmo que o servidor nao responda: o logout do
    // servidor so registra a auditoria (o JWT e stateless).
    clearSession();
    setSession(null);
    setStatus('unauthenticated');
    if (token) {
      await api.logout(token).catch(() => undefined);
    }
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      expiresAt: session?.expiresAt ?? null,
      login,
      logout,
    }),
    [status, session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  }
  return context;
}
