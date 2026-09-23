import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api, type FinancialEntry } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { EntryStatusBadge, EntryTypeBadge } from './EntryBadges';
import { entryCapabilities } from './entry-capabilities';
import { formatCurrency, formatEntryDate } from './finance-format';
import { formatDateTime } from '../users/format';

const NOT_FOUND = 'Lançamento não encontrado.';

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; entry: FinancialEntry };

/**
 * Detalhes de um lancamento (`GET /finance/entries/:id`).
 *
 * Serve tambem como a visao de leitura dos lancamentos congelados: um
 * CANCELADO nao abre formulario, mas continua consultavel aqui.
 *
 * O nome de quem criou ja vem resolvido em `criadoPor`, na propria resposta -
 * nenhuma requisicao extra por autor.
 */
export function FinanceEntryDetailPage(): ReactNode {
  const { id } = useParams();
  const { user: me, token, logout } = useAuth();
  const location = useLocation();

  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;

  useEffect(() => {
    if (!token || id === undefined) {
      return;
    }
    let cancelled = false;
    api.finance
      .get(token, id)
      .then((entry) => {
        if (!cancelled) {
          setLoaded({ state: 'ready', entry });
        }
      })
      .catch((caught: unknown) => {
        if (isSessionExpired(caught)) {
          void logout();
        }
        if (!cancelled) {
          setLoaded({
            state: 'error',
            message: describeApiError(caught, { notFound: NOT_FOUND }),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, id, logout]);

  let body: ReactNode;

  if (loaded.state === 'loading') {
    body = (
      <p className="muted" aria-busy="true">
        Carregando…
      </p>
    );
  } else if (loaded.state === 'error') {
    body = (
      <p className="alert" role="alert">
        {loaded.message}
      </p>
    );
  } else {
    const { entry } = loaded;
    const can = entryCapabilities(me, entry);
    return (
      <AppShell>
        <p>
          <Link to="/finance">← Financeiro</Link>
        </p>
        <div className="page-header">
          <div>
            <h1>{entry.descricao}</h1>
            <p className="muted">Lançamento financeiro.</p>
          </div>
          {can.edit && (
            <Link to={`/finance/${entry.id}/editar`} className="button button-secondary">
              Editar
            </Link>
          )}
        </div>

        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}

        <dl className="card info-grid">
          <dt>Tipo</dt>
          <dd>
            <EntryTypeBadge tipo={entry.tipo} />
          </dd>

          <dt>Status</dt>
          <dd>
            <EntryStatusBadge status={entry.status} />
          </dd>

          <dt>Valor</dt>
          <dd className={entry.tipo === 'RECEITA' ? 'amount-receita' : 'amount-despesa'}>
            {formatCurrency(entry.valor)}
          </dd>

          <dt>Data</dt>
          <dd>{formatEntryDate(entry.data)}</dd>

          <dt>Categoria</dt>
          <dd>{entry.categoria}</dd>

          <dt>Observação</dt>
          <dd>{entry.observacao ?? <span className="muted">Sem observação</span>}</dd>

          <dt>Criado por</dt>
          <dd>
            {entry.criadoPor ? (
              entry.criadoPor.nome
            ) : (
              // O backend devolve `criadoPor: null` quando o usuario nao existe
              // mais. Nao ha requisicao extra para tentar resolver o nome.
              <span className="muted mono" title={entry.criadoPorId}>
                Usuário removido ({entry.criadoPorId.slice(0, 8)})
              </span>
            )}
          </dd>

          <dt>Criado em</dt>
          <dd>{formatDateTime(entry.createdAt)}</dd>

          <dt>Atualizado em</dt>
          <dd>{formatDateTime(entry.updatedAt)}</dd>
        </dl>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <p>
        <Link to="/finance">← Financeiro</Link>
      </p>
      <h1>Lançamento</h1>
      {body}
    </AppShell>
  );
}
