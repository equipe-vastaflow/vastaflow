import { MAX_FILTER_YEAR, MAX_PERIOD_DAYS, MIN_FILTER_YEAR } from './plantae.constants';

const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Dia de calendario `AAAA-MM-DD`, ou `null` se o texto nao for uma data REAL.
 *
 * Valida o calendario de verdade (`2026-02-30`, `2026-13-01` e `2025-02-29`
 * sao recusados) e nao usa `Date.parse`, que aceita formatos que a API nao
 * aceita e "corrige" datas impossiveis em silencio.
 *
 * Nao ha fuso horario: e um dia de calendario, nao um instante. A conta de
 * periodo e feita em UTC so para a aritmetica nao depender do fuso do servidor.
 */
export function parseCalendarDate(
  text: string,
  limits: { minYear: number; maxYear: number } = { minYear: 1, maxYear: 9999 },
): CalendarDate | null {
  const match = DATE_FORMAT.exec(text);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < limits.minYear || year > limits.maxYear) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * Soma dias a um dia de calendario `AAAA-MM-DD`, em UTC (sem fuso, sem horario de
 * verao). `null` se a data de entrada nao for um dia real.
 */
export function addDaysToCalendarDate(text: string, days: number): string | null {
  const date = parseCalendarDate(text);
  if (!date) {
    return null;
  }
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1, 2)}-${pad(moved.getUTCDate(), 2)}`;
}

/**
 * O dia de HOJE em um fuso nomeado (padrao: o de Brasilia), como `AAAA-MM-DD`.
 * Usado so onde "hoje" e uma regra de negocio documentada (periodo padrao dos
 * comandos de chat); o fuso e fixo, nao o do servidor.
 */
export function todayInTimeZone(now: Date, timeZone = 'America/Sao_Paulo'): string {
  // `en-CA` formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `true` se o texto for um dia real. Usado nas datas que o Plantae DEVOLVE. */
export function isCalendarDate(text: string): boolean {
  return parseCalendarDate(text) !== null;
}

/**
 * Valida o periodo de um filtro e devolve os problemas (lista vazia = valido).
 * Os dois extremos sao incluidos, como na API: 2026-09-01 a 2026-09-30 sao 30
 * dias; o maximo de 366 dias cobre um ano bissexto inteiro.
 */
export function validatePeriod(dataInicio: string, dataFim: string): string[] {
  const limits = { minYear: MIN_FILTER_YEAR, maxYear: MAX_FILTER_YEAR };
  const problems: string[] = [];
  const inicio = parseCalendarDate(dataInicio, limits);
  const fim = parseCalendarDate(dataFim, limits);
  if (!inicio) {
    problems.push('data_inicio deve ser uma data real no formato AAAA-MM-DD');
  }
  if (!fim) {
    problems.push('data_fim deve ser uma data real no formato AAAA-MM-DD');
  }
  if (!inicio || !fim) {
    return problems;
  }
  const days =
    Math.round(
      (Date.UTC(fim.year, fim.month - 1, fim.day) -
        Date.UTC(inicio.year, inicio.month - 1, inicio.day)) /
        DAY_MS,
    ) + 1;
  if (days < 1) {
    problems.push('data_inicio nao pode ser posterior a data_fim');
  } else if (days > MAX_PERIOD_DAYS) {
    problems.push(`o periodo pode ter no maximo ${String(MAX_PERIOD_DAYS)} dias`);
  }
  return problems;
}
