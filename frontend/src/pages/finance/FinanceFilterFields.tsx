import type { ReactNode } from 'react';
import type { FinanceFilterForm } from './finance-filter-form';
import { STATUS_LABELS, TYPE_LABELS } from './finance-format';

interface FinanceFilterFieldsProps {
  value: FinanceFilterForm;
  onChange: (value: FinanceFilterForm) => void;
  /** Marca o periodo como obrigatorio - nos relatorios ele e. */
  requirePeriod?: boolean;
  disabled?: boolean;
  /** Prefixo dos `id`, para que duas instancias na mesma pagina nao colidam. */
  idPrefix: string;
}

/**
 * Campos do recorte financeiro, compartilhados pela listagem e pelos
 * relatorios.
 *
 * Um componente so para os dois: filtros duplicados divergiriam no primeiro
 * ajuste, e o backend trata os dois casos com o mesmo contrato. Quem usa decide
 * o que fazer no envio - aqui nao ha botao nem requisicao.
 */
export function FinanceFilterFields({
  value,
  onChange,
  requirePeriod = false,
  disabled = false,
  idPrefix,
}: FinanceFilterFieldsProps): ReactNode {
  function update(campo: keyof FinanceFilterForm, novo: string): void {
    onChange({ ...value, [campo]: novo });
  }

  return (
    <div className="filter-grid">
      <div className="field">
        <label htmlFor={`${idPrefix}-de`}>
          De{requirePeriod && <span aria-hidden="true"> *</span>}
        </label>
        <input
          id={`${idPrefix}-de`}
          type="date"
          value={value.de}
          required={requirePeriod}
          disabled={disabled}
          onChange={(event) => {
            update('de', event.target.value);
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-ate`}>
          Até{requirePeriod && <span aria-hidden="true"> *</span>}
        </label>
        <input
          id={`${idPrefix}-ate`}
          type="date"
          value={value.ate}
          required={requirePeriod}
          disabled={disabled}
          onChange={(event) => {
            update('ate', event.target.value);
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-tipo`}>Tipo</label>
        <select
          id={`${idPrefix}-tipo`}
          value={value.tipo}
          disabled={disabled}
          onChange={(event) => {
            update('tipo', event.target.value);
          }}
        >
          <option value="">Todos</option>
          {Object.entries(TYPE_LABELS).map(([codigo, rotulo]) => (
            <option key={codigo} value={codigo}>
              {rotulo}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-status`}>Situação</label>
        <select
          id={`${idPrefix}-status`}
          value={value.status}
          disabled={disabled}
          onChange={(event) => {
            update('status', event.target.value);
          }}
        >
          <option value="">Todas</option>
          {Object.entries(STATUS_LABELS).map(([codigo, rotulo]) => (
            <option key={codigo} value={codigo}>
              {rotulo}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-categoria`}>Categoria</label>
        <input
          id={`${idPrefix}-categoria`}
          type="text"
          value={value.categoria}
          maxLength={60}
          disabled={disabled}
          placeholder="Nome exato da categoria"
          onChange={(event) => {
            update('categoria', event.target.value);
          }}
        />
      </div>
    </div>
  );
}
