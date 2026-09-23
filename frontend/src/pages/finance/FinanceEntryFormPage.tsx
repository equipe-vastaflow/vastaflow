import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  api,
  type CreateFinancialEntryInput,
  type FinancialEntry,
  type FinancialEntryType,
  type UpdateFinancialEntryInput,
} from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { EntryStatusBadge } from './EntryBadges';
import { isFieldLocked, isFrozen } from './entry-capabilities';
import { amountToInput, parseAmount, STATUS_LABELS } from './finance-format';

const NOT_FOUND = 'Lançamento não encontrado.';
const EDIT_CONFLICT =
  'Este lançamento já mudou de situação e não aceita mais essa alteração. Volte à lista e abra o lançamento novamente.';

const AMOUNT_HINT = 'Use até duas casas decimais. Exemplo: 1234,56';
const LOCKED_HINT = 'Não pode ser alterado depois que o lançamento foi pago.';

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; entry: FinancialEntry | null };

interface FormState {
  tipo: FinancialEntryType | '';
  descricao: string;
  valor: string;
  data: string;
  categoria: string;
  observacao: string;
}

const EMPTY: FormState = {
  tipo: '',
  descricao: '',
  valor: '',
  data: '',
  categoria: '',
  observacao: '',
};

/**
 * Criacao (`/finance/novo`) e edicao (`/finance/:id/editar`) de lancamento.
 *
 * O status nao passa por aqui: na criacao o lancamento nasce PENDENTE no
 * backend, e a mudanca de situacao tem rota propria, acionada pela lista. O
 * autor tambem nao - vem da identidade autenticada.
 *
 * Na edicao, os campos que o status atual congela aparecem desabilitados, e
 * somente os campos realmente alterados sao enviados.
 */
export function FinanceEntryFormPage(): ReactNode {
  const { id } = useParams();
  const editing = id !== undefined;
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  const [loaded, setLoaded] = useState<Loaded>(
    editing ? { state: 'loading' } : { state: 'ready', entry: null },
  );
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token || id === undefined) {
      return;
    }
    let cancelled = false;
    api.finance
      .get(token, id)
      .then((entry) => {
        if (cancelled) {
          return;
        }
        setLoaded({ state: 'ready', entry });
        setForm({
          tipo: entry.tipo,
          descricao: entry.descricao,
          valor: amountToInput(entry.valor),
          data: entry.data,
          categoria: entry.categoria,
          observacao: entry.observacao ?? '',
        });
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

  if (!token) {
    return null;
  }
  const authToken = token;

  const entry = loaded.state === 'ready' ? loaded.entry : null;
  const status = entry?.status ?? 'PENDENTE';
  const locked = (field: Parameters<typeof isFieldLocked>[1]): boolean =>
    editing && isFieldLocked(status, field);

  const valorNumerico = parseAmount(form.valor);
  const faltando =
    form.tipo === '' ||
    !form.descricao.trim() ||
    !form.categoria.trim() ||
    !form.data ||
    valorNumerico === null;

  function update(patch: Partial<FormState>): void {
    setForm((current) => ({ ...current, ...patch }));
  }

  /**
   * Somente os campos alterados, e nunca um campo congelado pelo status -
   * enviar `valor` inalterado de um lancamento PAGO faria o backend recusar a
   * edicao inteira com 409.
   */
  function changedFields(original: FinancialEntry): UpdateFinancialEntryInput {
    const observacao = form.observacao.trim();
    const candidatos: UpdateFinancialEntryInput = {
      ...(form.tipo !== '' && form.tipo !== original.tipo ? { tipo: form.tipo } : {}),
      ...(form.descricao.trim() !== original.descricao
        ? { descricao: form.descricao.trim() }
        : {}),
      ...(valorNumerico !== null && valorNumerico !== original.valor
        ? { valor: valorNumerico }
        : {}),
      ...(form.data !== original.data ? { data: form.data } : {}),
      ...(form.categoria.trim() !== original.categoria
        ? { categoria: form.categoria.trim() }
        : {}),
      // O backend recusa observacao vazia; texto apagado nao e enviado.
      ...(observacao !== (original.observacao ?? '') && observacao !== '' ? { observacao } : {}),
    };
    return candidatos;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (valorNumerico === null || form.tipo === '') {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (entry) {
        const alteracoes = changedFields(entry);
        if (Object.keys(alteracoes).length === 0) {
          await navigate(`/finance/${entry.id}`, {
            state: { notice: 'Nenhuma alteração para salvar.' },
          });
          return;
        }
        const saved = await api.finance.update(authToken, entry.id, alteracoes);
        await navigate(`/finance/${saved.id}`, {
          state: { notice: 'Alterações salvas com sucesso.' },
        });
      } else {
        const observacao = form.observacao.trim();
        const input: CreateFinancialEntryInput = {
          tipo: form.tipo,
          descricao: form.descricao.trim(),
          valor: valorNumerico,
          data: form.data,
          categoria: form.categoria.trim(),
          ...(observacao === '' ? {} : { observacao }),
        };
        const created = await api.finance.create(authToken, input);
        await navigate('/finance', {
          state: { notice: `Lançamento "${created.descricao}" criado com sucesso.` },
        });
      }
    } catch (caught) {
      if (isSessionExpired(caught)) {
        void logout();
      }
      setError(describeApiError(caught, { conflict: EDIT_CONFLICT, notFound: NOT_FOUND }));
      setSubmitting(false);
    }
  }

  const title = editing ? 'Editar lançamento' : 'Novo lançamento';
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
  } else if (entry && isFrozen(entry.status)) {
    // CANCELADO nao abre formulario: nenhum campo e editavel.
    body = (
      <div className="alert" role="alert">
        <p>
          Este lançamento está {STATUS_LABELS[entry.status].toLowerCase()} e não pode mais ser
          editado. Para corrigir algo, registre um novo lançamento.
        </p>
        <Link to={`/finance/${entry.id}`} className="button button-secondary button-small">
          Ver detalhes
        </Link>
      </div>
    );
  } else {
    body = (
      <form className="card form-card" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {entry && (
          <p className="muted">
            Situação atual: <EntryStatusBadge status={entry.status} />
            {isFieldLocked(entry.status, 'valor') &&
              ' — tipo, valor e data já são fato consumado e não podem mais ser alterados.'}
          </p>
        )}

        <label className="field">
          <span>Tipo</span>
          <select
            name="tipo"
            value={form.tipo}
            disabled={locked('tipo')}
            aria-describedby={locked('tipo') ? 'tipo-bloqueado' : undefined}
            onChange={(event) => {
              update({ tipo: event.target.value as FinancialEntryType | '' });
            }}
            required
          >
            <option value="">Selecione…</option>
            <option value="RECEITA">Receita</option>
            <option value="DESPESA">Despesa</option>
          </select>
        </label>
        {locked('tipo') && (
          <small id="tipo-bloqueado" className="muted">
            {LOCKED_HINT}
          </small>
        )}

        <label className="field">
          <span>Descrição</span>
          <input
            name="descricao"
            value={form.descricao}
            maxLength={200}
            onChange={(event) => {
              update({ descricao: event.target.value });
            }}
            required
            autoFocus
          />
        </label>

        <div className="field">
          <label htmlFor="valor">Valor (R$)</label>
          <input
            id="valor"
            name="valor"
            type="text"
            inputMode="decimal"
            value={form.valor}
            disabled={locked('valor')}
            aria-describedby={locked('valor') ? 'valor-bloqueado' : 'valor-ajuda'}
            onChange={(event) => {
              update({ valor: event.target.value });
            }}
            required
          />
          <small id={locked('valor') ? 'valor-bloqueado' : 'valor-ajuda'} className="muted">
            {locked('valor') ? LOCKED_HINT : AMOUNT_HINT}
          </small>
          {form.valor.trim() !== '' && valorNumerico === null && !locked('valor') && (
            <small className="field-error" role="alert">
              Informe um valor maior que zero, com no máximo duas casas decimais.
            </small>
          )}
        </div>

        <div className="field">
          <label htmlFor="data">Data</label>
          <input
            id="data"
            name="data"
            type="date"
            value={form.data}
            disabled={locked('data')}
            aria-describedby={locked('data') ? 'data-bloqueado' : undefined}
            onChange={(event) => {
              update({ data: event.target.value });
            }}
            required
          />
          {locked('data') && (
            <small id="data-bloqueado" className="muted">
              {LOCKED_HINT}
            </small>
          )}
        </div>

        <label className="field">
          <span>Categoria</span>
          <input
            name="categoria"
            value={form.categoria}
            maxLength={60}
            onChange={(event) => {
              update({ categoria: event.target.value });
            }}
            required
          />
        </label>

        <label className="field">
          <span>Observação (opcional)</span>
          <input
            name="observacao"
            value={form.observacao}
            maxLength={500}
            onChange={(event) => {
              update({ observacao: event.target.value });
            }}
          />
        </label>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <Link to={entry ? `/finance/${entry.id}` : '/finance'} className="button button-secondary">
            Cancelar
          </Link>
          <button type="submit" className="button" disabled={submitting || faltando}>
            {submitting ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar lançamento'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <AppShell>
      <p>
        <Link to="/finance">← Financeiro</Link>
      </p>
      <h1>{title}</h1>
      {body}
    </AppShell>
  );
}
