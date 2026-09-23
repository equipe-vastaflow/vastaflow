import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  api,
  type FinancialEntry,
  type FinancialEntryPage,
  type FinancialEntryStatus,
} from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission, Permission } from '../../auth/permissions';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pagination } from '../../components/Pagination';
import { EntryStatusBadge, EntryTypeBadge } from './EntryBadges';
import { entryCapabilities } from './entry-capabilities';
import { formatCurrency, formatEntryDate, STATUS_LABELS } from './finance-format';

const PAGE_SIZE = 20;

/**
 * 409 quer dizer que o lancamento mudou de situacao desde que a tela o
 * carregou. A mensagem tecnica do backend ("Transicao PAGO -> PENDENTE nao
 * permitida") nao ajuda quem esta usando a tela, entao ela e traduzida aqui.
 */
const STATUS_CONFLICT =
  'Este lançamento já mudou de situação. Atualize a lista para ver o estado atual.';

type Outcome = { ok: true; page: FinancialEntryPage } | { ok: false; message: string };

interface PendingStatus {
  entry: FinancialEntry;
  destino: FinancialEntryStatus;
}

/**
 * Lancamentos financeiros.
 *
 * Consome `GET /finance/entries`, paginado no backend: a tela pede uma pagina
 * por vez e usa o `total` devolvido. Nada e contado, somado nem fatiado aqui -
 * o frontend nao faz conta com dinheiro.
 */
export function FinancePage(): ReactNode {
  const { user: me, token, logout } = useAuth();
  const location = useLocation();

  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  // O resultado guarda a chave da consulta que o produziu: enquanto a chave
  // atual nao tem resultado, a tela esta carregando (mesmo padrao das outras).
  const requestKey = `${page}:${reloads}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const [notice, setNotice] = useState<string | null>(
    () => (location.state as { notice?: string } | null)?.notice ?? null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const handleError = useCallback(
    (error: unknown, messages: { conflict?: string; notFound?: string } = {}): string => {
      if (isSessionExpired(error)) {
        void logout();
      }
      return describeApiError(error, messages);
    },
    [logout],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    api.finance
      .list(token, page, PAGE_SIZE)
      .then((entryPage) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, page: entryPage } });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: false, message: handleError(error) } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, requestKey, handleError]);

  const closeDialog = useCallback(() => {
    setPending(null);
  }, []);

  if (!me || !token) {
    return null;
  }
  const authToken = token;

  function confirmStatus(): void {
    if (!pending) {
      return;
    }
    const { entry, destino } = pending;
    // `busy` desabilita os botoes de acao e o proprio confirmar do dialogo,
    // entao um clique repetido nao dispara uma segunda requisicao.
    setBusy(true);
    setNotice(null);
    setActionError(null);
    api.finance
      .setStatus(authToken, entry.id, destino)
      .then((updated) => {
        setNotice(
          `Lançamento "${updated.descricao}" agora está como ${STATUS_LABELS[updated.status]}.`,
        );
        // Recarrega a pagina atual em vez de recarregar o navegador.
        setReloads((count) => count + 1);
      })
      .catch((error: unknown) => {
        setActionError(
          handleError(error, {
            conflict: STATUS_CONFLICT,
            notFound: 'Lançamento não encontrado. Ele pode ter sido removido.',
          }),
        );
      })
      .finally(() => {
        setBusy(false);
        setPending(null);
      });
  }

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;
  const cancelando = pending?.destino === 'CANCELADO';

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Financeiro</h1>
          <p className="muted">Receitas e despesas registradas no VastaFlow.</p>
        </div>
        {hasPermission(me, Permission.FinanceCreate) && (
          <Link to="/finance/novo" className="button">
            Novo lançamento
          </Link>
        )}
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="alert" role="alert">
          {actionError}
        </p>
      )}

      {loading && (
        <p className="muted" aria-busy="true">
          Carregando lançamentos…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar os lançamentos. {outcome.message}</p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setReloads((count) => count + 1);
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {outcome?.ok && outcome.page.items.length === 0 && (
        <p className="card muted">
          {outcome.page.total === 0
            ? 'Nenhum lançamento registrado ainda.'
            : 'Nenhum lançamento nesta página.'}
        </p>
      )}

      {outcome?.ok && outcome.page.items.length > 0 && (
        <>
          <div className="card table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">Descrição</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Data</th>
                  <th scope="col">Status</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {outcome.page.items.map((entry) => {
                  const can = entryCapabilities(me, entry);
                  return (
                    <tr key={entry.id}>
                      <td>
                        <EntryTypeBadge tipo={entry.tipo} />
                      </td>
                      <td className="cell-wrap">{entry.descricao}</td>
                      <td>{entry.categoria}</td>
                      <td
                        className={
                          entry.tipo === 'RECEITA' ? 'amount amount-receita' : 'amount amount-despesa'
                        }
                      >
                        {formatCurrency(entry.valor)}
                      </td>
                      <td>{formatEntryDate(entry.data)}</td>
                      <td>
                        <EntryStatusBadge status={entry.status} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <Link
                            to={`/finance/${entry.id}`}
                            className="button button-secondary button-small"
                          >
                            Ver
                          </Link>
                          {can.edit && (
                            <Link
                              to={`/finance/${entry.id}/editar`}
                              className="button button-secondary button-small"
                            >
                              Editar
                            </Link>
                          )}
                          {can.transitions.includes('PAGO') && (
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              disabled={busy}
                              onClick={() => {
                                setPending({ entry, destino: 'PAGO' });
                              }}
                            >
                              Marcar como pago
                            </button>
                          )}
                          {can.transitions.includes('CANCELADO') && (
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              disabled={busy}
                              onClick={() => {
                                setPending({ entry, destino: 'CANCELADO' });
                              }}
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={outcome.page.page}
            total={outcome.page.total}
            limit={outcome.page.limit}
            onChange={setPage}
            label={{ singular: 'lançamento', plural: 'lançamentos' }}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title={cancelando ? 'Cancelar lançamento?' : 'Marcar como pago?'}
          confirmLabel={cancelando ? 'Confirmar cancelamento' : 'Confirmar pagamento'}
          cancelLabel="Voltar"
          danger={cancelando}
          busy={busy}
          onConfirm={confirmStatus}
          onCancel={closeDialog}
        >
          <p>
            <strong>{pending.entry.descricao}</strong> ·{' '}
            {formatCurrency(pending.entry.valor)} · {formatEntryDate(pending.entry.data)}
          </p>
          <p>
            {cancelando
              ? 'Essa ação não poderá ser desfeita: um lançamento cancelado não volta atrás nem pode ser editado.'
              : 'Depois de pago, tipo, valor e data não poderão mais ser alterados.'}
          </p>
        </ConfirmDialog>
      )}
    </AppShell>
  );
}
