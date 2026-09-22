import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Shortcut {
  label: string;
  descricao: string;
  /** Rota da aplicacao, ou ancora para uma secao desta pagina. */
  to: string;
}

/**
 * Atalhos para o que JA existe.
 *
 * "Usuários" aponta para `/users`, uma rota real. "Auditoria" ainda nao tem
 * pagina propria no frontend, entao o atalho leva a secao de auditoria desta
 * mesma pagina (ancora), em vez de criar um link para uma rota inexistente.
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
        {atalhos.map((atalho) => {
          const conteudo = (
            <>
              <span className="shortcut-label">{atalho.label}</span>
              <span className="muted">{atalho.descricao}</span>
            </>
          );

          // Ancora na propria pagina usa `<a>`: nao ha rota para navegar.
          return atalho.to.startsWith('#') ? (
            <a key={atalho.to} href={atalho.to} className="card shortcut-card">
              {conteudo}
            </a>
          ) : (
            <Link key={atalho.to} to={atalho.to} className="card shortcut-card">
              {conteudo}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
