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
  /** JWT da sessao, para as chamadas autenticadas; `null` sem sessao. */
  token: string | null;
  /** Instante (ms) em que o token expira; `null` sem sessao. */
  expiresAt: number | null;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Rele o usuario da sessao no servidor (ex.: depois de ele editar os proprios dados). */
  refreshUser: () => Promise<void>;
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
  // Lida uma unica vez, na montagem. Sem sessao guardada (ou ja expirada) o
  // estado inicial ja e 'unauthenticated' - nao ha o que confirmar com o servidor.
  const [stored] = useState(() => {
    const saved = loadSession();
    return saved && saved.expiresAt > Date.now() ? saved : null;
  });
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(stored ? 'loading' : 'unauthenticated');

  // Ao abrir/recarregar a pagina, confirma com o servidor que o token guardado
  // ainda vale (nao expirou, usuario segue ativo) antes de liberar o dashboard.
  useEffect(() => {
    if (!stored) {
      // Remove do armazenamento qualquer sessao expirada; o estado ja esta certo.
      clearSession();
      return;
    }

    let cancelled = false;
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
  }, [stored]);

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

  const refreshUser = useCallback(async (): Promise<void> => {
    if (!session) {
      return;
    }
    const user = await api.me(session.token);
    setSession((current) => (current?.token === session.token ? { ...current, user } : current));
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      token: session?.token ?? null,
      expiresAt: session?.expiresAt ?? null,
      login,
      logout,
      refreshUser,
    }),
    [status, session, login, logout, refreshUser],
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
