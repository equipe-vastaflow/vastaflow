import type { ReactNode } from 'react';
import type { PlantaePagination, PlantaePerson } from '../../api/client';
import { maskedDocument, personName } from './plantae-format';
import type { PlantaeBusy } from './use-plantae-query';

/** "Consultando…" e a mensagem de erro (ja amigavel) de uma aba. */
export function QueryFeedback({
  busy,
  error,
}: {
  busy: PlantaeBusy;
  error: string | null;
}): ReactNode {
  return (
    <>
      {busy === 'consultando' && (
        <p className="muted" aria-busy="true">
          Consultando o Plantae…
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * "Carregar mais" quando ha cursor (e o Plantae nao disse que acabou); aviso
 * quando o Plantae nao informa se ha mais. Nunca se afirma que a lista acabou sem
 * a API dizer.
 */
export function LoadMore({
  pagination,
  busy,
  onLoadMore,
  itens,
  label = 'Carregar mais',
}: {
  pagination: PlantaePagination;
  busy: PlantaeBusy;
  onLoadMore: () => void;
  /** Plural do que e listado, para o aviso ("parcelas", "contas"...). */
  itens: string;
  label?: string;
}): ReactNode {
  const podeCarregar = pagination.nextCursor !== null && pagination.hasMore !== false;
  return (
    <>
      {podeCarregar && (
        <div className="row-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== 'idle'}
            onClick={onLoadMore}
          >
            {busy === 'carregando-mais' ? 'Carregando…' : label}
          </button>
        </div>
      )}
      {pagination.hasMore === null && pagination.nextCursor === null && (
        <p className="muted">O Plantae não informou se há mais {itens} para estes filtros.</p>
      )}
    </>
  );
}

/** Nome da pessoa e, embaixo, o documento - so se ja veio mascarado. */
export function PersonCell({ pessoa }: { pessoa: PlantaePerson | null }): ReactNode {
  const documento = maskedDocument(pessoa);
  return (
    <td className="cell-wrap">
      {personName(pessoa)}
      {documento && (
        <>
          <br />
          <span className="muted mono">{documento}</span>
        </>
      )}
    </td>
  );
}

/** `C` entrada / `D` saida, sempre por extenso (a cor so reforca). */
export function NatureBadge({ codigo }: { codigo: string }): ReactNode {
  if (codigo === 'C') {
    return <span className="badge badge-receita">Entrada</span>;
  }
  if (codigo === 'D') {
    return <span className="badge badge-despesa">Saída</span>;
  }
  return <span className="badge">{codigo}</span>;
}

/** Campos de periodo (`AAAA-MM-DD`). Os rotulos variam: "Vencimento de", "De"... */
export function PeriodFields({
  idPrefix,
  de,
  ate,
  onChange,
  labelDe = 'De',
  labelAte = 'Até',
}: {
  idPrefix: string;
  de: string;
  ate: string;
  onChange: (campo: 'de' | 'ate', valor: string) => void;
  labelDe?: string;
  labelAte?: string;
}): ReactNode {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-de`}>{labelDe}</label>
        <input
          id={`${idPrefix}-de`}
          type="date"
          required
          value={de}
          onChange={(event) => {
            onChange('de', event.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-ate`}>{labelAte}</label>
        <input
          id={`${idPrefix}-ate`}
          type="date"
          required
          value={ate}
          onChange={(event) => {
            onChange('ate', event.target.value);
          }}
        />
      </div>
    </>
  );
}

/** Mensagem de validacao do formulario (antes de qualquer chamada). */
export function FormError({ message }: { message: string | null }): ReactNode {
  return message ? (
    <p className="field-error" role="alert">
      {message}
    </p>
  ) : null;
}
