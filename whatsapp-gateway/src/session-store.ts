import type { SessionHandle, SessionStore } from './ports.js';

/** O armazenamento definitivo da sessao ainda nao existe (etapa 3). */
export class SessionStoreNotImplementedError extends Error {
  constructor() {
    super('armazenamento da sessao nao implementado (etapa 3)');
    this.name = 'SessionStoreNotImplementedError';
  }
}

/**
 * Armazenamento PLACEHOLDER: recusa abrir sessao. Existe para que o gateway nao consiga conectar nenhuma conta
 * enquanto a sessao nao tiver um lugar seguro (cifrada, fora do Git e fora do backup, com trava de instancia unica).
 *
 * NAO e um armazenamento "de desenvolvimento": nao guarda nada, de proposito. `useMultiFileAuthState` tambem nao e
 * usado (muitos arquivos soltos, sem trava, sem cifra).
 */
export class NotImplementedSessionStore implements SessionStore {
  open(): Promise<SessionHandle> {
    return Promise.reject(new SessionStoreNotImplementedError());
  }

  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}
