import { useCallback, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  api,
  type FinanceReportFilter,
  type FinanceReportSummary,
} from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { downloadFile } from './download-file';
import { FinanceFilterFields } from './FinanceFilterFields';
import {
  EMPTY_FILTER_FORM,
  toFinanceFilter,
  type FinanceFilterForm,
} from './finance-filter-form';
import { formatCurrency, STATUS_LABELS, TYPE_LABELS } from './finance-format';

/** Mensagem do 409 da exportacao: o recorte tem mais linhas que o limite. */
const EXPORT_TOO_LARGE =
  'O período selecionado tem lançamentos demais para uma única planilha. Reduza o período ou use mais filtros.';

type Outcome =
  | { ok: true; summary: FinanceReportSummary }
  | { ok: false; message: string };

/**
 * Relatorios do financeiro: resumo do periodo e exportacao em Excel.
 *
 * Nenhum numero desta tela e calculado aqui. Todos vem de
 * `GET /finance/reports/summary`, que agrega no banco - somar no cliente
 * exigiria carregar todos os lancamentos e daria um total so do que estivesse
 * carregado.
 *
 * O periodo e obrigatorio: e ele que limita o custo da consulta. O recorte
 * comeca no mes corrente para a tela abrir com algo util.
 */
export function FinanceReportsPage(): ReactNode {
  const { token, logout } = useAuth();

  const [form, setForm] = useState<FinanceFilterForm>(currentMonthForm);
  const [result, setResult] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const handleError = useCallback(
    (error: unknown, messages: { conflict?: string } = {}): string => {
      if (isSessionExpired(error)) {
        void logout();
      }
      return describeApiError(error, messages);
    },
    [logout],
  );

  if (!token) {
    return null;
  }
  const authToken = token;

  /**
   * Confere o que da para conferir sem ir ao servidor: as duas datas presentes e
   * na ordem certa.
   *
   * O limite de tamanho do periodo NAO e repetido aqui de proposito - ele e uma
   * regra do backend, e duplicar a constante faria as duas versoes divergirem.
   * Quando o periodo e longo demais, a mensagem do backend e exibida.
   */
  function validatePeriod(): FinanceReportFilter | null {
    if (form.de === '' || form.ate === '') {
      setFormError('Informe as duas datas do período.');
      return null;
    }
    if (form.ate < form.de) {
      setFormError('A data final não pode ser anterior à inicial.');
      return null;
    }
    setFormError(null);
    return { ...toFinanceFilter(form), de: form.de, ate: form.ate };
  }

  function gerar(): void {
    const filter = validatePeriod();
    if (!filter) {
      return;
    }
    setLoading(true);
    setExportError(null);
    setExportNotice(null);
    api.finance.reports
      .summary(authToken, filter)
      .then((summary) => {
        setResult({ ok: true, summary });
      })
      .catch((error: unknown) => {
        setResult({ ok: false, message: handleError(error) });
      })
      .finally(() => {
        setLoading(false);
      });
  }

  function exportar(): void {
    const filter = validatePeriod();
    if (!filter) {
      return;
    }
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    api.finance.reports
      .export(authToken, filter)
      .then((arquivo) => {
        downloadFile(arquivo);
        setExportNotice(`Planilha "${arquivo.filename}" baixada.`);
      })
      .catch((error: unknown) => {
        setExportError(handleError(error, { conflict: EXPORT_TOO_LARGE }));
      })
      .finally(() => {
        setExporting(false);
      });
  }

  const busy = loading || exporting;

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Relatórios do financeiro</h1>
          <p className="muted">
            Totais do período e exportação dos lançamentos em planilha. Os valores são calculados
            pelo servidor.
          </p>
        </div>
        <Link to="/finance" className="button button-secondary">
          Ver lançamentos
        </Link>
      </div>

      {/* `noValidate` desliga a validacao nativa do navegador, mas os campos
          seguem marcados como `required` - o atributo e o que avisa o leitor de
          tela. Sem isto haveria duas validacoes com mensagens diferentes: a
          bolha do navegador no botao de gerar (que submete o formulario) e a
          mensagem desta tela no botao de exportar (que nao submete). */}
      <form
        className="card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          gerar();
        }}
      >
        <FinanceFilterFields
          idPrefix="relatorio"
          value={form}
          onChange={setForm}
          requirePeriod
          disabled={busy}
        />

        {formError && (
          <p className="alert" role="alert">
            {formError}
          </p>
        )}

        <div className="row-actions">
          <button type="submit" className="button" disabled={busy}>
            {loading ? 'Gerando…' : 'Gerar relatório'}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={exportar}
          >
            {exporting ? 'Gerando planilha…' : 'Exportar Excel'}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              setForm(EMPTY_FILTER_FORM);
              setResult(null);
              setFormError(null);
              setExportError(null);
              setExportNotice(null);
            }}
          >
            Limpar filtros
          </button>
        </div>
      </form>

      {exportNotice && (
        <p className="notice" role="status">
          {exportNotice}
        </p>
      )}
      {exportError && (
        <p className="alert" role="alert">
          {exportError}
        </p>
      )}

      {loading && (
        <p className="muted" aria-busy="true">
          Calculando totais…
        </p>
      )}

      {!loading && result && !result.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível gerar o relatório. {result.message}</p>
        </div>
      )}

      {!loading && result?.ok && <ReportBody summary={result.summary} />}
    </AppShell>
  );
}

/** Resultado do relatorio: totais e os tres agrupamentos. */
function ReportBody({ summary }: { summary: FinanceReportSummary }): ReactNode {
  if (summary.totalRegistros === 0) {
    return (
      <p className="card muted">
        Nenhum lançamento no período selecionado. Ajuste as datas ou os filtros.
      </p>
    );
  }

  return (
    <>
      <div className="stat-grid">
        <TotalCard
          label="Lançamentos"
          value={String(summary.totalRegistros)}
          hint="Inclui os cancelados"
        />
        <TotalCard
          label="Receitas"
          value={formatCurrency(summary.totalReceitas)}
          hint="Sem os cancelados"
          tone="receita"
        />
        <TotalCard
          label="Despesas"
          value={formatCurrency(summary.totalDespesas)}
          hint="Sem os cancelados"
          tone="despesa"
        />
        <TotalCard
          label="Saldo"
          value={formatCurrency(summary.saldo)}
          hint="Receitas menos despesas"
          tone={summary.saldo < 0 ? 'despesa' : 'receita'}
        />
      </div>

      <section className="card table-wrapper">
        <h2>Por situação</h2>
        <p className="muted">
          Os cancelados aparecem aqui, mas não entram no saldo nem nos totais de receitas e
          despesas.
        </p>
        <GroupTable
          header="Situação"
          rows={summary.porStatus.map((linha) => ({
            key: linha.status,
            label: STATUS_LABELS[linha.status],
            quantidade: linha.quantidade,
            valor: linha.valor,
          }))}
        />
      </section>

      <section className="card table-wrapper">
        <h2>Por tipo</h2>
        <GroupTable
          header="Tipo"
          rows={summary.porTipo.map((linha) => ({
            key: linha.tipo,
            label: TYPE_LABELS[linha.tipo],
            quantidade: linha.quantidade,
            valor: linha.valor,
          }))}
        />
      </section>

      <section className="card table-wrapper">
        <h2>Por categoria</h2>
        <GroupTable
          header="Categoria"
          rows={summary.porCategoria.map((linha) => ({
            key: linha.categoria,
            label: linha.categoria,
            quantidade: linha.quantidade,
            valor: linha.valor,
          }))}
        />
      </section>
    </>
  );
}

/**
 * Um total do periodo. Reaproveita o cartao do painel (`stat-card`) em vez de
 * criar um estilo paralelo para a mesma coisa.
 */
function TotalCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'receita' | 'despesa';
}): ReactNode {
  return (
    <article className="card stat-card">
      <p className="stat-label">{label}</p>
      {/* O rotulo nomeia o numero: o par e lido junto pelo leitor de tela. */}
      <p className={tone === undefined ? 'stat-value' : `stat-value amount-${tone}`}>{value}</p>
      <p className="muted stat-hint">{hint}</p>
    </article>
  );
}

interface GroupRow {
  key: string;
  label: string;
  quantidade: number;
  valor: number;
}

/**
 * Uma tabela de agrupamento.
 *
 * `valor` e sempre positivo, como vem da API: nos agrupamentos ele e a SOMA dos
 * lancamentos daquele grupo, e nao um resultado liquido.
 */
function GroupTable({ header, rows }: { header: string; rows: GroupRow[] }): ReactNode {
  if (rows.length === 0) {
    return <p className="muted">Nada a mostrar neste agrupamento.</p>;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">{header}</th>
          <th scope="col">Lançamentos</th>
          <th scope="col">Soma</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((linha) => (
          <tr key={linha.key}>
            <td>{linha.label}</td>
            <td>{linha.quantidade}</td>
            <td className="amount">{formatCurrency(linha.valor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Recorte inicial: do primeiro dia do mes corrente ate hoje.
 *
 * Montado a partir das partes locais da data, nao de `toISOString()`: aquele
 * converte para UTC e, num fuso negativo, no primeiro dia do mes devolveria o
 * mes anterior.
 */
function currentMonthForm(): FinanceFilterForm {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');

  return { ...EMPTY_FILTER_FORM, de: `${ano}-${mes}-01`, ate: `${ano}-${mes}-${dia}` };
}
