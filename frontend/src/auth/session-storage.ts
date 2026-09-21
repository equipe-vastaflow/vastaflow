const STORAGE_KEY = 'vastaflow.session';

export interface StoredSession {
  token: string;
  /** Instante de expiracao do token, em milissegundos desde a epoca. */
  expiresAt: number;
}

/**
 * Guarda o token no `localStorage` para sobreviver a recarregar a pagina.
 *
 * Trade-off conhecido: qualquer script executado na pagina (XSS) consegue ler o
 * `localStorage`. A alternativa, cookie httpOnly, exige mudancas no backend
 * (emissao do cookie e protecao contra CSRF) e fica para o hardening.
 */
export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Armazenamento indisponivel (modo privado, cota): a sessao vale so ate recarregar.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada a limpar.
  }
}
