import { useState, type ReactNode } from 'react';
import {
  api,
  type PlantaeAccount,
  type PlantaeAccountType,
  type PlantaeAccountsQuery,
  type PlantaeList,
} from '../../api/client';
import { ACCOUNT_TYPE_LABELS, accountTypeLabel, maskedAccountNumber } from './plantae-format';
import { LoadMore, QueryFeedback } from './plantae-ui';
import { appendList, usePlantaeQuery } from './use-plantae-query';

/** `''` = todos os tipos. */
type TipoFiltro = '' | '1' | '2' | '3' | '4';

/**
 * Contas de caixa, bancarias, aplicacoes e numerario em transito
 * (`financial/accounts`). O Plantae nao traz saldo aqui (o saldo e do extrato) e o
 * numero da conta chega MASCARADO pelo backend.
 */
export function AccountsTab(): ReactNode {
  const [tipo, setTipo] = useState<TipoFiltro>('');
  const { loaded, error, busy, consultar, carregarMais } = usePlantaeQuery<
    PlantaeAccountsQuery,
    PlantaeList<PlantaeAccount>
  >(api.plantae.accounts, appendList);

  const items = loaded?.result.data ?? [];

  return (
    <section aria-labelledby="plantae-contas-titulo">
      <h2 id="plantae-contas-titulo" className="sr-only">
        Contas bancárias
      </h2>

      <form
        className="card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          consultar(tipo === '' ? {} : { tipo: Number(tipo) as PlantaeAccountType });
        }}
      >
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="plantae-contas-tipo">Tipo de conta</label>
            <select
              id="plantae-contas-tipo"
              value={tipo}
              onChange={(event) => {
                setTipo(event.target.value as TipoFiltro);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([codigo, rotulo]) => (
                <option key={codigo} value={codigo}>
                  {rotulo}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row-actions">
          <button type="submit" className="button" disabled={busy !== 'idle'}>
            {busy === 'consultando' ? 'Consultando…' : 'Consultar'}
          </button>
        </div>
      </form>

      <QueryFeedback busy={busy} error={error} />

      {loaded && (
        <>
          <p className="muted" role="status">
            {loaded.query.tipo === undefined
              ? 'Todos os tipos'
              : ACCOUNT_TYPE_LABELS[loaded.query.tipo]}{' '}
            · {items.length} {items.length === 1 ? 'conta' : 'contas'}
          </p>

          {items.length === 0 ? (
            <p className="card muted">Nenhuma conta encontrada para o filtro aplicado.</p>
          ) : (
            <div className="card table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Banco</th>
                    <th scope="col">Agência</th>
                    <th scope="col">Conta</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((conta, index) => (
                    <tr key={`${String(conta.conta_id)}-${String(index)}`}>
                      <td className="cell-wrap">{conta.nome?.trim() || '—'}</td>
                      <td>{accountTypeLabel(conta.tipo)}</td>
                      <td className="cell-wrap">{conta.banco?.nome?.trim() || '—'}</td>
                      <td>{conta.agencia?.trim() || '—'}</td>
                      <td className="mono">{maskedAccountNumber(conta.numero_conta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted">
            O número da conta aparece só com os últimos quatro dígitos. Saldos ficam na aba
            Extratos.
          </p>

          <LoadMore
            pagination={loaded.result.pagination}
            busy={busy}
            itens="contas"
            onLoadMore={() => {
              const cursor = loaded.result.pagination.nextCursor;
              if (cursor) {
                carregarMais({ ...loaded.query, cursor });
              }
            }}
          />
        </>
      )}
    </section>
  );
}
