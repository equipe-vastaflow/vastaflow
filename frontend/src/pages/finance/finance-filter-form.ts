import type { FinanceFilter } from '../../api/client';

/**
 * O recorte como os campos do formulario o guardam: tudo texto.
 *
 * Campo vazio e o estado natural de um `<input>`, e e o que significa "sem esse
 * filtro". Guardar `undefined` aqui obrigaria a converter nos dois sentidos a
 * cada tecla; a conversao acontece uma vez, em `toFinanceFilter`.
 */
export interface FinanceFilterForm {
  de: string;
  ate: string;
  status: string;
  tipo: string;
  categoria: string;
}

export const EMPTY_FILTER_FORM: FinanceFilterForm = {
  de: '',
  ate: '',
  status: '',
  tipo: '',
  categoria: '',
};

/**
 * Converte o formulario no recorte que a API recebe, descartando o que esta
 * vazio.
 *
 * A conversao de `status` e `tipo` e segura porque os valores possiveis vem dos
 * proprios `<option>`, montados a partir de `STATUS_LABELS`/`TYPE_LABELS` - nao
 * ha como digitar outro -, e o backend valida de novo de todo modo.
 */
export function toFinanceFilter(form: FinanceFilterForm): FinanceFilter {
  const filter: FinanceFilter = {};
  if (form.de !== '') {
    filter.de = form.de;
  }
  if (form.ate !== '') {
    filter.ate = form.ate;
  }
  if (form.status !== '') {
    filter.status = form.status as NonNullable<FinanceFilter['status']>;
  }
  if (form.tipo !== '') {
    filter.tipo = form.tipo as NonNullable<FinanceFilter['tipo']>;
  }
  const categoria = form.categoria.trim();
  if (categoria !== '') {
    filter.categoria = categoria;
  }
  return filter;
}

/** `true` quando nenhum filtro foi preenchido. */
export function isEmptyFilterForm(form: FinanceFilterForm): boolean {
  return (
    form.de === '' &&
    form.ate === '' &&
    form.status === '' &&
    form.tipo === '' &&
    form.categoria.trim() === ''
  );
}
