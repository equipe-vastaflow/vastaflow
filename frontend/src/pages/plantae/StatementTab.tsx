import { useState, type ReactNode } from 'react';
import {
  api,
  type PlantaeAccount,
  type PlantaeAccountsQuery,
  type PlantaeList,
  type PlantaeStatement,
  type PlantaeStatementQuery,
} from '../../api/client';
import {
  accountTypeLabel,
  currentMonthPeriod,
  formatPlantaeDate,
  formatPlantaeDecimal,
  maskedAccountNumber,
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

/**
 * Acrescenta as linhas da proxima pagina e MANTEM os saldos da primeira: eles sao
 * do periodo inteiro e iguais em todas as paginas (o backend confere). Nada e
 * somado nem recalculado aqui.
 */
function appendStatement(anterior: PlantaeStatement, proxima: PlantaeStatement): PlantaeStatement {
  return {
    data: [...anterior.data, ...proxima.data],
    pagination: proxima.pagination,
    saldos: anterior.saldos,
  };
}

/** Rotulo da conta na lista: nome, tipo e numero ja mascarado. Nunca o id. */
function accountOption(conta: PlantaeAccount): string {
  const partes = [conta.nome?.trim() || 'Conta sem nome', accountTypeLabel(conta.tipo)];
  const numero = maskedAccountNumber(conta.numero_conta);
  if (numero !== '—') {
    partes.push(numero);
  }
  return partes.join(' · ');
}

/**
 * Extrato de UMA conta (`financial/account-statement`).
 *
 * Dois passos, cada um so ao clicar: (1) carregar as contas (`financial/accounts`)
 * para escolher; (2) consultar o extrato. Saldo anterior, saldo final e o saldo de
 * cada linha sao EXATAMENTE os do Plantae: o frontend nao soma nem calcula saldo, e
 * nao presume moeda (o contrato nao a informa).
 */
export function StatementTab(): ReactNode {
  const contas = usePlantaeQuery<PlantaeAccountsQuery, PlantaeList<PlantaeAccount>>(
    api.plantae.accounts,
    appendList,
  );
  const extrato = usePlantaeQuery<PlantaeStatementQuery, PlantaeStatement>(
    api.plantae.statement,
    appendStatement,
  );
  const [contaId, setContaId] = useState('');
  const [periodo, setPeriodo] = useState(currentMonthPeriod);
  const [formError, setFormError] = useState<string | null>(null);

  const listaDeContas = contas.loaded?.result.data ?? [];
  const ocupado = contas.busy !== 'idle' || extrato.busy !== 'idle';

  function submit(): void {
    const problema =
      contaId === '' ? 'Selecione uma conta.' : periodProblem(periodo.de, periodo.ate);
    setFormError(problema);
    if (!problema) {
      extrato.consultar({ contaId: Number(contaId), dataInicio: periodo.de, dataFim: periodo.ate });
    }
  }

  const contaConsultada = extrato.loaded
    ? listaDeContas.find((conta) => conta.conta_id === extrato.loaded?.query.contaId)
    : undefined;
  const linhas = extrato.loaded?.result.data ?? [];

  return (
    <section aria-labelledby="plantae-extratos-titulo">
      <h2 id="plantae-extratos-titulo" className="sr-only">
        Extratos
      </h2>

      <div className="card">
        <div className="row-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={ocupado}
            onClick={() => {
              setContaId('');
              contas.consultar({});
            }}
          >
            {contas.busy === 'consultando'
              ? 'Carregando contas…'
              : contas.loaded
                ? 'Recarregar contas'
                : 'Carregar contas'}
          </button>
          {contas.loaded && (
            <span className="muted">
              {listaDeContas.length} {listaDeContas.length === 1 ? 'conta' : 'contas'}
            </span>
          )}
        </div>
        <QueryFeedback busy={contas.busy} error={contas.error} />
        {contas.loaded && (
          <LoadMore
            pagination={contas.loaded.result.pagination}
            busy={contas.busy}
            itens="contas"
            label="Carregar mais contas"
            onLoadMore={() => {
              const cursor = contas.loaded?.result.pagination.nextCursor;
              if (contas.loaded && cursor) {
                contas.carregarMais({ ...contas.loaded.query, cursor });
              }
            }}
          />
        )}
      </div>

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
            <label htmlFor="plantae-extratos-conta">Conta</label>
            <select
              id="plantae-extratos-conta"
              value={contaId}
              disabled={listaDeContas.length === 0}
              onChange={(event) => {
                setContaId(event.target.value);
              }}
            >
              <option value="">
                {contas.loaded ? 'Selecione uma conta' : 'Carregue as contas primeiro'}
              </option>
              {listaDeContas.map((conta) => (
                <option key={conta.conta_id} value={String(conta.conta_id)}>
                  {accountOption(conta)}
                </option>
              ))}
            </select>
          </div>

          <PeriodFields
            idPrefix="plantae-extratos"
            de={periodo.de}
            ate={periodo.ate}
            onChange={(campo, valor) => {
              setPeriodo((atual) => ({ ...atual, [campo]: valor }));
            }}
          />
        </div>

        <FormError message={formError} />

        <div className="row-actions">
          <button type="submit" className="button" disabled={ocupado}>
            {extrato.busy === 'consultando' ? 'Consultando…' : 'Consultar'}
          </button>
        </div>
      </form>

      <QueryFeedback busy={extrato.busy} error={extrato.error} />

      {extrato.loaded && (
        <>
          <p className="muted" role="status">
            {contaConsultada ? accountOption(contaConsultada) : 'Conta selecionada'} ·{' '}
            {formatPlantaeDate(extrato.loaded.query.dataInicio)} a{' '}
            {formatPlantaeDate(extrato.loaded.query.dataFim)} · {linhas.length}{' '}
            {linhas.length === 1 ? 'movimento' : 'movimentos'}
          </p>

          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Saldo anterior</span>
              <span className="stat-value">
                {formatPlantaeDecimal(extrato.loaded.result.saldos.saldo_anterior)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Saldo final</span>
              <span className="stat-value">
                {formatPlantaeDecimal(extrato.loaded.result.saldos.saldo_final)}
              </span>
            </div>
          </div>

          {linhas.length === 0 ? (
            <p className="card muted">Nenhum movimento nesta conta no período.</p>
          ) : (
            <div className="card table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Entrada/Saída</th>
                    <th scope="col">Descrição</th>
                    <th scope="col">Pessoa</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((mov, index) => (
                    <tr key={`${String(mov.mov_conta_id)}-${String(index)}`}>
                      <td>{formatPlantaeDate(mov.data)}</td>
                      <td>
                        <NatureBadge codigo={mov.natureza.codigo} />
                      </td>
                      <td className="cell-wrap">{mov.descricao?.trim() || '—'}</td>
                      <PersonCell pessoa={mov.pessoa} />
                      <td className="amount">{formatPlantaeDecimal(mov.valor)}</td>
                      <td className="amount">{formatPlantaeDecimal(mov.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted">
            Saldos do período inteiro e saldo de cada linha exatamente como informados pelo Plantae,
            sem símbolo de moeda (a API não informa a moeda do extrato). Não é conciliação bancária.
          </p>

          <LoadMore
            pagination={extrato.loaded.result.pagination}
            busy={extrato.busy}
            itens="movimentos"
            onLoadMore={() => {
              const cursor = extrato.loaded?.result.pagination.nextCursor;
              if (extrato.loaded && cursor) {
                extrato.carregarMais({ ...extrato.loaded.query, cursor });
              }
            }}
          />
        </>
      )}
    </section>
  );
}
