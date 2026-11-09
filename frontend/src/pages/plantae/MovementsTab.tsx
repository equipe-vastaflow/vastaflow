import { useState, type ReactNode } from 'react';
import {
  api,
  type PlantaeList,
  type PlantaeMovement,
  type PlantaeMovementsQuery,
} from '../../api/client';
import {
  conciliationLabel,
  currentMonthPeriod,
  formatPlantaeDate,
  formatPlantaeDecimal,
  periodProblem,
} from './plantae-format';
import {
  FormError,
  LoadMore,
  NatureBadge,
  PeriodFields,
  PersonCell,
  QueryFeedback,
} from './plantae-ui';
import { appendList, usePlantaeQuery } from './use-plantae-query';

interface FilterForm {
  de: string;
  ate: string;
  /** `''` = entradas e saidas. */
  natureza: '' | 'C' | 'D';
  /** `''` = conciliadas ou nao. */
  conciliado: '' | 'true' | 'false';
}

function toQuery(form: FilterForm): PlantaeMovementsQuery {
  return {
    dataInicio: form.de,
    dataFim: form.ate,
    ...(form.natureza === '' ? {} : { natureza: form.natureza }),
    ...(form.conciliado === '' ? {} : { conciliado: form.conciliado === 'true' }),
  };
}

function describeQuery(query: PlantaeMovementsQuery): string {
  const natureza =
    query.natureza === 'C' ? 'entradas' : query.natureza === 'D' ? 'saídas' : 'entradas e saídas';
  const conciliacao =
    query.conciliado === undefined
      ? 'conciliadas ou não'
      : query.conciliado
        ? 'conciliadas'
        : 'não conciliadas';
  return `${formatPlantaeDate(query.dataInicio)} a ${formatPlantaeDate(query.dataFim)} · ${natureza} · ${conciliacao}`;
}

/**
 * Movimentacoes financeiras (`financial/movements`): entradas e saidas das contas.
 *
 * O contrato nao traz a moeda (a documentacao da API fala em reais): o valor sai
 * sem simbolo, como veio. A listagem nao traz saldo por linha (isso e do extrato).
 */
export function MovementsTab(): ReactNode {
  const [form, setForm] = useState<FilterForm>(() => ({
    ...currentMonthPeriod(),
    natureza: '',
    conciliado: '',
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const { loaded, error, busy, consultar, carregarMais } = usePlantaeQuery<
    PlantaeMovementsQuery,
    PlantaeList<PlantaeMovement>
  >(api.plantae.movements, appendList);

  function submit(): void {
    const problema = periodProblem(form.de, form.ate);
    setFormError(problema);
    if (!problema) {
      consultar(toQuery(form));
    }
  }

  function update<K extends keyof FilterForm>(campo: K, valor: FilterForm[K]): void {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  const items = loaded?.result.data ?? [];

  return (
    <section aria-labelledby="plantae-movimentacoes-titulo">
      <h2 id="plantae-movimentacoes-titulo" className="sr-only">
        Movimentações
      </h2>

      <form
        className="card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="filter-grid">
          <PeriodFields
            idPrefix="plantae-movimentacoes"
            de={form.de}
            ate={form.ate}
            onChange={update}
          />

          <div className="field">
            <label htmlFor="plantae-movimentacoes-natureza">Natureza</label>
            <select
              id="plantae-movimentacoes-natureza"
              value={form.natureza}
              onChange={(event) => {
                update('natureza', event.target.value as FilterForm['natureza']);
              }}
            >
              <option value="">Entradas e saídas</option>
              <option value="C">Entradas (crédito)</option>
              <option value="D">Saídas (débito)</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="plantae-movimentacoes-conciliado">Conciliação</label>
            <select
              id="plantae-movimentacoes-conciliado"
              value={form.conciliado}
              onChange={(event) => {
                update('conciliado', event.target.value as FilterForm['conciliado']);
              }}
            >
              <option value="">Todas</option>
              <option value="true">Conciliadas</option>
              <option value="false">Não conciliadas</option>
            </select>
          </div>
        </div>

        <FormError message={formError} />

        <div className="row-actions">
          <button type="submit" className="button" disabled={busy !== 'idle'}>
            {busy === 'consultando' ? 'Consultando…' : 'Consultar'}
          </button>
        </div>
      </form>

      <p className="muted">
        A API do Plantae não inclui movimentos estornados nem compras no cartão de crédito (aparece
        o pagamento da fatura): a lista pode não representar toda a movimentação.
      </p>

      <QueryFeedback busy={busy} error={error} />

      {loaded && (
        <>
          <p className="muted" role="status">
            {describeQuery(loaded.query)} · {items.length}{' '}
            {items.length === 1 ? 'movimentação' : 'movimentações'}
          </p>

          {items.length === 0 ? (
            <p className="card muted">Nenhuma movimentação encontrada para os filtros aplicados.</p>
          ) : (
            <div className="card table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Conta</th>
                    <th scope="col">Entrada/Saída</th>
                    <th scope="col">Descrição</th>
                    <th scope="col">Pessoa</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Conciliação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((mov, index) => (
                    <tr key={`${String(mov.mov_conta_id)}-${String(index)}`}>
                      <td>{formatPlantaeDate(mov.data)}</td>
                      <td className="cell-wrap">{mov.conta.nome?.trim() || '—'}</td>
                      <td>
                        <NatureBadge codigo={mov.natureza.codigo} />
                      </td>
                      <td className="cell-wrap">{mov.descricao?.trim() || '—'}</td>
                      <PersonCell pessoa={mov.pessoa} />
                      <td className="amount">{formatPlantaeDecimal(mov.valor)}</td>
                      <td>{conciliationLabel(mov.conciliado, mov.data_conciliacao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted">
            Valores como informados pelo Plantae, sem símbolo de moeda (a API não informa a moeda
            nesta consulta).
          </p>

          <LoadMore
            pagination={loaded.result.pagination}
            busy={busy}
            itens="movimentações"
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
