import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Shortcut {
  label: string;
  descricao: string;
  /** Rota da aplicacao. */
  to: string;
}

/**
 * Atalhos para telas que JA existem: `/users` e `/audit-logs`.
 *
 * Financeiro, automacoes e integracoes NAO aparecem aqui: nao existem. Quando
 * existirem, basta acrescentar o atalho na lista montada pelo `DashboardPage`.
 */
export function AdminShortcuts({ atalhos }: { atalhos: Shortcut[] }): ReactNode {
  if (atalhos.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="titulo-atalhos">
      <h2 id="titulo-atalhos">Atalhos</h2>
      <div className="stat-grid">
        {atalhos.map((atalho) => (
          <Link key={atalho.to} to={atalho.to} className="card shortcut-card">
            <span className="shortcut-label">{atalho.label}</span>
            <span className="muted">{atalho.descricao}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
