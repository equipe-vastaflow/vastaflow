import { useState, type ReactNode } from 'react';
import {
  api,
  type PlantaeEntriesQuery,
  type PlantaeEntry,
  type PlantaeEntryKind,
  type PlantaeEntryStatusCode,
  type PlantaeList,
} from '../../api/client';
import { EntryTypeBadge } from '../finance/EntryBadges';
import {
  COUNTERPART_LABELS,
  currentMonthPeriod,
  ENTRY_KIND_LABELS,
  ENTRY_STATUS_LABELS,
  entryStatusView,
  formatPlantaeDate,
  formatPlantaeDecimal,
  installmentLabel,
  periodProblem,
} from './plantae-format';
import { FormError, LoadMore, PeriodFields, PersonCell, QueryFeedback } from './plantae-ui';
import { appendList, usePlantaeQuery } from './use-plantae-query';

interface FilterForm {
  de: string;
  ate: string;
  tipo: PlantaeEntryKind;
  /** `''` = todas as situacoes. */
  status: '' | '0' | '1' | '2';
}

const STATUS_OPTIONS: Array<[FilterForm['status'], string]> = [
  ['', 'Todas'],
  ['0', 'Pendentes'],
  ['1', 'Quitadas'],
  ['2', 'Substituídas (renegociadas)'],
];

function toQuery(form: FilterForm): PlantaeEntriesQuery {
  return {
    dataInicio: form.de,
    dataFim: form.ate,
    tipo: form.tipo,
    ...(form.status === '' ? {} : { status: Number(form.status) as PlantaeEntryStatusCode }),
  };
}

/**
 * Contas a pagar e a receber do Plantae (`financial/entries`), uma linha por PARCELA.
 *
 * - so consulta ao clicar em Consultar, uma por vez, sem atualizacao automatica
 *   (`usePlantaeQuery`); 50 parcelas por chamada;
 * - "Carregar mais" usa o cursor opaco com os MESMOS filtros da consulta original
 *   (nao os que estao nos campos agora);
 * - o tipo da linha (pagar/receber) vem do FILTRO, porque a parcela do Plantae nao
 *   o informa - por isso o tipo e obrigatorio.
 */
export function EntriesTab(): ReactNode {
  const [form, setForm] = useState<FilterForm>(() => ({
    ...currentMonthPeriod(),
    tipo: 'despesa',
    status: '',
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const { loaded, error, busy, consultar, carregarMais } = usePlantaeQuery<
    PlantaeEntriesQuery,
    PlantaeList<PlantaeEntry>
  >(api.plantae.entries, appendList);

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
    <section aria-labelledby="plantae-lancamentos-titulo">
      <h2 id="plantae-lancamentos-titulo" className="sr-only">
        Contas a pagar e receber
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
          <div className="field">
            <label htmlFor="plantae-lancamentos-tipo">Tipo</label>
            <select
              id="plantae-lancamentos-tipo"
              value={form.tipo}
              onChange={(event) => {
                update('tipo', event.target.value as PlantaeEntryKind);
              }}
            >
              <option value="despesa">A pagar (despesas)</option>
              <option value="receita">A receber (receitas)</option>
            </select>
          </div>

          <PeriodFields
            idPrefix="plantae-lancamentos"
            de={form.de}
            ate={form.ate}
            labelDe="Vencimento de"
            labelAte="Vencimento até"
            onChange={update}
          />

          <div className="field">
            <label htmlFor="plantae-lancamentos-status">Situação</label>
            <select
              id="plantae-lancamentos-status"
              value={form.status}
              onChange={(event) => {
                update('status', event.target.value as FilterForm['status']);
              }}
            >
              {STATUS_OPTIONS.map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
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

      <QueryFeedback busy={busy} error={error} />

      {loaded && (
        <>
          <p className="muted" role="status">
            {ENTRY_KIND_LABELS[loaded.query.tipo]} · vencimento de{' '}
            {formatPlantaeDate(loaded.query.dataInicio)} a {formatPlantaeDate(loaded.query.dataFim)}{' '}
            ·{' '}
            {loaded.query.status === undefined
              ? 'todas as situações'
              : ENTRY_STATUS_LABELS[loaded.query.status].toLowerCase()}{' '}
            · {items.length} {items.length === 1 ? 'parcela' : 'parcelas'}
          </p>

          {items.length === 0 ? (
            <p className="card muted">Nenhuma parcela encontrada para os filtros aplicados.</p>
          ) : (
            <div className="card table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Vencimento</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">{COUNTERPART_LABELS[loaded.query.tipo]}</th>
                    <th scope="col">Descrição</th>
                    <th scope="col">Parcela</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Saldo</th>
                    <th scope="col">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry, index) => {
                    const simbolo = entry.titulo.moeda?.simbolo;
                    const status = entryStatusView(entry.status);
                    return (
                      <tr key={`${String(entry.parcela_id)}-${String(index)}`}>
                        <td>{formatPlantaeDate(entry.data_vencto)}</td>
                        <td>
                          <EntryTypeBadge
                            tipo={loaded.query.tipo === 'receita' ? 'RECEITA' : 'DESPESA'}
                          />
                        </td>
                        <PersonCell pessoa={entry.pessoa} />
                        <td className="cell-wrap">
                          {entry.titulo.descricao?.trim() || '—'}
                          {entry.titulo.num_documento && (
                            <>
                              <br />
                              <span className="muted">Doc. {entry.titulo.num_documento}</span>
                            </>
                          )}
                        </td>
                        <td>{installmentLabel(entry.numero, entry.total_parcelas)}</td>
                        <td className="amount">{formatPlantaeDecimal(entry.valor, simbolo)}</td>
                        <td className="amount">
                          {formatPlantaeDecimal(entry.saldo_atual, simbolo)}
                        </td>
                        <td>
                          <span className={status.className}>{status.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted">
            Valores na moeda do título. O saldo é o saldo atual da parcela informado pelo Plantae.
          </p>

          <LoadMore
            pagination={loaded.result.pagination}
            busy={busy}
            itens="parcelas"
            onLoadMore={() => {
              const cursor = loaded.result.pagination.nextCursor;
              if (cursor) {
                // Sempre a consulta ORIGINAL: o cursor so vale para os filtros que o geraram.
                carregarMais({ ...loaded.query, cursor });
              }
            }}
          />
        </>
      )}
    </section>
  );
}
