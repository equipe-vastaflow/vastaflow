import type {
  PlantaeAccountType,
  PlantaeCodedValue,
  PlantaeEntryKind,
  PlantaeEntryStatusCode,
  PlantaePerson,
} from '../../api/client';
import { formatEntryDate } from '../finance/finance-format';

/** Mesmo formato que o backend aceita para valores do Plantae. */
const DECIMAL = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

/** Exibido quando o dado nao veio (ou veio fora do contrato). */
export const EMPTY = '—';

/**
 * Espaco nao separavel entre simbolo e numero (`R$ 1,00` nao quebra linha), o
 * mesmo que o `Intl` usa em `formatCurrency`.
 */
export const NBSP = String.fromCharCode(0xa0);

/**
 * Formata o TEXTO decimal do Plantae no padrao brasileiro: `8337.10` vira
 * `R$ 8.337,10`.
 *
 * Feito na string, sem `Number` nem `Intl`: converter para ponto flutuante
 * poderia arredondar centavos (ou casas a mais que a API mande). Nenhuma casa
 * e descartada - `1.234` vira `1,234` - e no minimo duas sao exibidas.
 *
 * O simbolo e o da MOEDA DO TITULO (`titulo.moeda.simbolo`). Sem simbolo, sai so
 * o numero: nunca se presume real. Valor fora do formato vira `—`, em vez de um
 * numero inventado.
 */
export function formatPlantaeDecimal(
  valor: string | null | undefined,
  simbolo?: string | null,
): string {
  if (valor === null || valor === undefined) {
    return EMPTY;
  }
  const match = DECIMAL.exec(valor);
  if (!match) {
    return EMPTY;
  }
  const sinal = match[1] ?? '';
  const inteiro = match[2] ?? '0';
  const fracao = match[3] ?? '';
  const milhares = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const numero = `${milhares},${fracao.padEnd(2, '0')}`;
  // `-0.00` nao e negativo.
  const negativo = sinal === '-' && /[1-9]/.test(inteiro + fracao);
  const prefixo = simbolo?.trim() ? `${simbolo.trim()}${NBSP}` : '';
  return `${negativo ? '-' : ''}${prefixo}${numero}`;
}

/** Data `AAAA-MM-DD` do Plantae como `DD/MM/AAAA`, sem passar por fuso. */
export function formatPlantaeDate(data: string | null | undefined): string {
  return data ? formatEntryDate(data) : EMPTY;
}

export const ENTRY_KIND_LABELS: Record<PlantaeEntryKind, string> = {
  despesa: 'Contas a pagar',
  receita: 'Contas a receber',
};

/**
 * O Plantae nao diz se uma pessoa e cliente ou fornecedor. O papel so e conhecido
 * NO LANCAMENTO: quem aparece numa despesa e o favorecido; numa receita, o cliente.
 */
export const COUNTERPART_LABELS: Record<PlantaeEntryKind, string> = {
  despesa: 'Fornecedor/Favorecido',
  receita: 'Cliente',
};

export const ENTRY_STATUS_LABELS: Record<PlantaeEntryStatusCode, string> = {
  0: 'Pendente',
  1: 'Quitada',
  // Renegociacao ou desmembramento: NAO e cancelada.
  2: 'Substituída (renegociada)',
};

const ENTRY_STATUS_CLASS: Record<PlantaeEntryStatusCode, string> = {
  0: 'badge badge-pendente',
  1: 'badge badge-pago',
  2: 'badge badge-warning',
};

const isKnownStatus = (codigo: number): codigo is PlantaeEntryStatusCode =>
  codigo === 0 || codigo === 1 || codigo === 2;

/** Rotulo e classe do status da parcela. Codigo desconhecido usa a descricao da API. */
export function entryStatusView(status: PlantaeCodedValue<number>): {
  label: string;
  className: string;
} {
  if (isKnownStatus(status.codigo)) {
    return {
      label: ENTRY_STATUS_LABELS[status.codigo],
      className: ENTRY_STATUS_CLASS[status.codigo],
    };
  }
  return { label: status.descricao ?? `Código ${String(status.codigo)}`, className: 'badge' };
}

/** `1/3`; so o numero quando o total nao veio; `—` sem numero. */
export function installmentLabel(numero: number | null, total: number | null): string {
  if (numero === null) {
    return EMPTY;
  }
  return total === null ? String(numero) : `${String(numero)}/${String(total)}`;
}

/** Nome para exibir: nome, razao social ou `—`. */
export function personName(pessoa: PlantaePerson | null): string {
  return pessoa?.nome?.trim() || pessoa?.razao_social?.trim() || EMPTY;
}

/**
 * O documento so e exibido se ja vier MASCARADO pelo backend (tem `*`). Defesa em
 * profundidade: se um dia a mascara falhar, a tela esconde em vez de mostrar.
 */
export function maskedDocument(pessoa: PlantaePerson | null): string | null {
  const documento = pessoa?.cpf_cnpj;
  return documento && documento.includes('*') ? documento : null;
}

/**
 * Numero de conta so como veio MASCARADO do backend (`****1234`). Sem mascara,
 * a tela mostra `—`: o numero completo nunca e exibido.
 */
export function maskedAccountNumber(numero: string | null): string {
  return numero && numero.includes('*') ? numero : EMPTY;
}

export const ACCOUNT_TYPE_LABELS: Record<PlantaeAccountType, string> = {
  1: 'Caixa',
  2: 'Conta bancária',
  3: 'Aplicação',
  4: 'Numerário em trânsito',
};

/** Rotulo do tipo de conta; codigo desconhecido usa a descricao da API. */
export function accountTypeLabel(tipo: PlantaeCodedValue<number> | null): string {
  if (tipo === null) {
    return EMPTY;
  }
  const conhecido = ACCOUNT_TYPE_LABELS[tipo.codigo as PlantaeAccountType] as string | undefined;
  return conhecido ?? tipo.descricao ?? `Código ${String(tipo.codigo)}`;
}

/** `F` pessoa fisica, `J` juridica (preservado como veio quando for outro valor). */
export function personTypeLabel(tipo: string | null): string {
  if (tipo === 'F') {
    return 'Física (F)';
  }
  if (tipo === 'J') {
    return 'Jurídica (J)';
  }
  return tipo?.trim() || EMPTY;
}

/** Situacao da conciliacao de uma movimentacao. */
export function conciliationLabel(conciliado: boolean, data: string | null): string {
  if (!conciliado) {
    return 'Não conciliado';
  }
  return data ? `Conciliado em ${formatPlantaeDate(data)}` : 'Conciliado';
}

const SEARCH_MIN = 2;
const SEARCH_MAX = 100;

const hasControlChars = (texto: string): boolean =>
  [...texto].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * Mesma regra do backend para a `busca` de pessoas. Vazio = sem busca (valido).
 * Devolve a mensagem do problema, ou `null`.
 */
export function searchProblem(busca: string): string | null {
  const texto = busca.trim();
  if (texto === '') {
    return null;
  }
  if (texto.length < SEARCH_MIN || texto.length > SEARCH_MAX || hasControlChars(texto)) {
    return `A busca deve ter de ${String(SEARCH_MIN)} a ${String(SEARCH_MAX)} caracteres.`;
  }
  return null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PERIOD_DAYS = 366;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Primeiro e ultimo dia do mes de `hoje`, no calendario local. */
export function currentMonthPeriod(hoje: Date = new Date()): { de: string; ate: string } {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const ultimo = new Date(ano, mes, 0).getDate();
  return { de: `${String(ano)}-${pad(mes)}-01`, ate: `${String(ano)}-${pad(mes)}-${pad(ultimo)}` };
}

function utcDay(texto: string): number | null {
  const match = ISO_DATE.exec(texto);
  if (!match) {
    return null;
  }
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const instante = Date.UTC(ano, mes - 1, dia);
  const data = new Date(instante);
  // Recusa datas que o `Date` "corrigiria" (ex.: 31/02).
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }
  return instante;
}

/**
 * Mesma regra do backend (extremos incluidos, ate 366 dias), conferida ANTES de
 * consultar para nao gastar uma chamada ao Plantae com um periodo invalido.
 * Devolve a mensagem do problema, ou `null` quando o periodo e valido.
 */
export function periodProblem(de: string, ate: string): string | null {
  if (!de || !ate) {
    return 'Informe o período (data inicial e final).';
  }
  const inicio = utcDay(de);
  const fim = utcDay(ate);
  if (inicio === null || fim === null) {
    return 'Informe datas válidas.';
  }
  const dias = Math.round((fim - inicio) / 86_400_000) + 1;
  if (dias < 1) {
    return 'A data inicial não pode ser posterior à final.';
  }
  if (dias > MAX_PERIOD_DAYS) {
    return `O período pode ter no máximo ${String(MAX_PERIOD_DAYS)} dias.`;
  }
  return null;
}
