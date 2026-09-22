import type { ReactNode } from 'react';

interface PaginationProps {
  /** Pagina atual, 1-based. */
  page: number;
  /** Total de itens em todas as paginas, informado pelo backend. */
  total: number;
  limit: number;
  onChange: (page: number) => void;
  /** Substantivo contado ao lado do total: "12 usuários", "3 eventos". */
  label: { singular: string; plural: string };
}

/**
 * Navegacao entre paginas. O numero de paginas vem do `total` do backend -
 * nunca de uma contagem feita no frontend.
 */
export function Pagination({ page, total, limit, onChange, label }: PaginationProps): ReactNode {
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <nav className="pagination" aria-label="Paginação">
      <button
        type="button"
        className="button button-secondary button-small"
        disabled={page <= 1}
        onClick={() => {
          onChange(page - 1);
        }}
      >
        Anterior
      </button>
      <span className="muted">
        Página {page} de {pages} · {total} {total === 1 ? label.singular : label.plural}
      </span>
      <button
        type="button"
        className="button button-secondary button-small"
        disabled={page >= pages}
        onClick={() => {
          onChange(page + 1);
        }}
      >
        Próxima
      </button>
    </nav>
  );
}
