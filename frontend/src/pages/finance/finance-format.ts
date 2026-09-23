import type { FinancialEntryStatus, FinancialEntryType } from '../../api/client';

const CURRENCY_FORMAT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Formata o valor como moeda brasileira: `R$ 1.234,56`.
 *
 * Apenas apresentacao - nenhuma conta e feita aqui. O total, o saldo e
 * qualquer agregacao sao responsabilidade do backend; o frontend so exibe o
 * numero que recebeu.
 */
export const formatCurrency = (valor: number): string => CURRENCY_FORMAT.format(valor);

/** `YYYY-MM-DD` vindo do backend. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formata a data do lancamento como `DD/MM/AAAA`.
 *
 * Feito na string, sem passar por `Date`, de proposito. `new Date('2026-09-23')`
 * e interpretado como meia-noite **UTC**; exibido em um fuso negativo (o
 * horario de Brasilia e UTC-3), viraria 22/09/2026. O campo do backend e um
 * DATE - um dia do calendario, sem hora e sem fuso -, entao converter para
 * instante so teria como introduzir esse erro.
 *
 * Datas com hora (`createdAt`/`updatedAt`) sao outra coisa e continuam usando
 * `formatDateTime`, que corretamente converte o instante para o fuso local.
 */
export function formatEntryDate(data: string): string {
  const match = ISO_DATE.exec(data);
  if (!match) {
    // Formato inesperado: mostra como veio, em vez de inventar uma data.
    return data;
  }
  const [, ano, mes, dia] = match;
  return `${dia}/${mes}/${ano}`;
}

export const TYPE_LABELS: Record<FinancialEntryType, string> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
};

export const STATUS_LABELS: Record<FinancialEntryStatus, string> = {
  PENDENTE: 'Pendente',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
};

/**
 * Converte o texto digitado no campo de valor para numero.
 *
 * Aceita virgula ou ponto como separador decimal - quem digita em portugues
 * escreve `1234,56`. A validacao e feita sobre o TEXTO (regex), nao sobre o
 * numero: checar casas decimais depois de converter para ponto flutuante
 * poderia aceitar um valor que o backend recusaria.
 *
 * @returns o numero, ou `null` quando o texto nao e um valor monetario valido.
 */
export function parseAmount(texto: string): number | null {
  const normalizado = texto.trim().replace(',', '.');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(normalizado)) {
    return null;
  }
  const valor = Number(normalizado);
  return valor > 0 ? valor : null;
}

/** Valor do backend no formato que o campo de edicao espera (`1234.56`). */
export const amountToInput = (valor: number): string => valor.toFixed(2);
