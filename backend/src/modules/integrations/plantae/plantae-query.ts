import { validatePeriod } from './plantae-dates';
import { PlantaeInputError } from './plantae-errors';
import {
  CURSOR_MAX_LENGTH,
  DEFAULT_PAGES_PER_CALL,
  MAX_FILTER_IDS,
  MAX_PAGES_PER_CALL,
  PER_PAGE_MAX,
  PER_PAGE_MIN,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
} from './plantae.constants';

/**
 * Filtros de cada consulta, com os NOMES e valores da colecao oficial.
 *
 * O `build*` valida tudo antes de montar a query string - e e a unica porta
 * para ela. Valor de usuario nunca e concatenado em URL: vai por
 * `URLSearchParams`, que codifica.
 */

export interface PageOptions {
  readonly perPage?: number;
  /** Cursor OPACO de uma pagina anterior. Nao se monta, nao se altera. */
  readonly cursor?: string;
  /** Quantas paginas esta chamada le (1 a `MAX_PAGES_PER_CALL`). */
  readonly maxPages?: number;
}

interface PeriodFilter {
  readonly dataInicio: string;
  readonly dataFim: string;
}

export type EntryKind = 'receita' | 'despesa';
/** 0 pendente, 1 quitada, 2 substituida (NAO e cancelada). */
export type EntryStatus = 0 | 1 | 2;
/** 1 caixa, 2 bancaria, 3 aplicacao, 4 numerario em transito. */
export type AccountType = 1 | 2 | 3 | 4;
export type MovementNature = 'C' | 'D';
export type InvoiceStatus = 'autorizada' | 'cancelada';
export type InvoiceOperation = 'entrada' | 'saida';

export interface EntriesQuery extends PageOptions, PeriodFilter {
  readonly tipo?: EntryKind;
  readonly status?: readonly EntryStatus[];
  readonly pessoaIds?: readonly number[];
  readonly razaoSocialIds?: readonly number[];
}

export interface AccountsQuery extends PageOptions {
  readonly tipos?: readonly AccountType[];
}

export interface MovementsQuery extends PageOptions, PeriodFilter {
  readonly contaIds?: readonly number[];
  readonly natureza?: MovementNature;
  /** Origens documentadas: 1 a 13. */
  readonly origens?: readonly number[];
  readonly conciliado?: boolean;
}

export interface StatementQuery extends PageOptions, PeriodFilter {
  readonly contaId: number;
}

export interface InvoicesQuery extends PageOptions, PeriodFilter {
  readonly razaoSocialIds?: readonly number[];
  readonly situacao?: InvoiceStatus;
  readonly operacao?: InvoiceOperation;
}

export type LegalEntitiesQuery = PageOptions;

export interface PeopleQuery extends PageOptions {
  /** Parte do nome, nome fantasia, razao social ou CPF/CNPJ. Dado pessoal: nunca em log. */
  readonly busca?: string;
}

export const ENTRY_KINDS: readonly EntryKind[] = ['receita', 'despesa'];
export const ENTRY_STATUSES: readonly EntryStatus[] = [0, 1, 2];
export const ACCOUNT_TYPES: readonly AccountType[] = [1, 2, 3, 4];
export const MOVEMENT_NATURES: readonly MovementNature[] = ['C', 'D'];
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['autorizada', 'cancelada'];
export const INVOICE_OPERATIONS: readonly InvoiceOperation[] = ['entrada', 'saida'];
export const MOVEMENT_ORIGIN_MIN = 1;
export const MOVEMENT_ORIGIN_MAX = 13;

const CURSOR_FORMAT = /^[\x21-\x7E]+$/;

/** Caractere de controle (< 0x20 ou DEL). Por codigo, sem regex: `no-control-regex` nao admite. */
function hasControlChars(text: string): boolean {
  return [...text].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function checkIds(
  name: string,
  ids: readonly number[] | undefined,
  problems: string[],
  range: { min: number; max: number } = { min: 1, max: Number.MAX_SAFE_INTEGER },
): void {
  if (ids === undefined) {
    return;
  }
  if (ids.length === 0 || ids.length > MAX_FILTER_IDS) {
    problems.push(`${name} deve ter de 1 a ${String(MAX_FILTER_IDS)} valores`);
    return;
  }
  if (ids.some((id) => !Number.isSafeInteger(id) || id < range.min || id > range.max)) {
    problems.push(`${name} deve conter inteiros de ${String(range.min)} a ${String(range.max)}`);
  }
}

function checkOneOf<T>(
  name: string,
  value: T | undefined,
  allowed: readonly T[],
  problems: string[],
): void {
  if (value !== undefined && !allowed.includes(value)) {
    problems.push(`${name} invalido`);
  }
}

function checkList<T>(
  name: string,
  values: readonly T[] | undefined,
  allowed: readonly T[],
  problems: string[],
): void {
  if (values === undefined) {
    return;
  }
  if (values.length === 0 || values.length > allowed.length) {
    problems.push(`${name} deve ter de 1 a ${String(allowed.length)} valores`);
    return;
  }
  if (values.some((value) => !allowed.includes(value))) {
    problems.push(`${name} invalido`);
  }
}

function checkPage(page: PageOptions, problems: string[]): void {
  if (
    page.perPage !== undefined &&
    (!Number.isInteger(page.perPage) || page.perPage < PER_PAGE_MIN || page.perPage > PER_PAGE_MAX)
  ) {
    problems.push(`per_page deve ser de ${String(PER_PAGE_MIN)} a ${String(PER_PAGE_MAX)}`);
  }
  if (
    page.maxPages !== undefined &&
    (!Number.isInteger(page.maxPages) || page.maxPages < 1 || page.maxPages > MAX_PAGES_PER_CALL)
  ) {
    problems.push(`paginas deve ser de 1 a ${String(MAX_PAGES_PER_CALL)}`);
  }
  if (
    page.cursor !== undefined &&
    (page.cursor.length === 0 ||
      page.cursor.length > CURSOR_MAX_LENGTH ||
      !CURSOR_FORMAT.test(page.cursor))
  ) {
    problems.push('cursor invalido');
  }
}

function checkPeriod(query: PeriodFilter, problems: string[]): void {
  problems.push(...validatePeriod(query.dataInicio, query.dataFim));
}

function finish(problems: string[]): void {
  if (problems.length > 0) {
    throw new PlantaeInputError(problems);
  }
}

function pageParams(page: PageOptions): URLSearchParams {
  const params = new URLSearchParams();
  if (page.perPage !== undefined) {
    params.set('per_page', String(page.perPage));
  }
  return params;
}

function appendList(
  params: URLSearchParams,
  key: string,
  values: readonly unknown[] | undefined,
): void {
  for (const value of values ?? []) {
    params.append(`${key}[]`, String(value));
  }
}

/** Paginas efetivas desta chamada. */
export function effectiveMaxPages(page: PageOptions): number {
  return page.maxPages ?? DEFAULT_PAGES_PER_CALL;
}

export function buildMeParams(): URLSearchParams {
  return new URLSearchParams();
}

export function buildEntriesParams(query: EntriesQuery): URLSearchParams {
  const problems: string[] = [];
  checkPage(query, problems);
  checkPeriod(query, problems);
  checkOneOf('tipo', query.tipo, ENTRY_KINDS, problems);
  checkList('status', query.status, ENTRY_STATUSES, problems);
  checkIds('pessoa_id', query.pessoaIds, problems);
  checkIds('razao_social_id', query.razaoSocialIds, problems);
  finish(problems);

  const params = pageParams(query);
  params.set('data_inicio', query.dataInicio);
  params.set('data_fim', query.dataFim);
  if (query.tipo !== undefined) {
    params.set('tipo', query.tipo);
  }
  appendList(params, 'status', query.status);
  appendList(params, 'pessoa_id', query.pessoaIds);
  appendList(params, 'razao_social_id', query.razaoSocialIds);
  return params;
}

export function buildAccountsParams(query: AccountsQuery): URLSearchParams {
  const problems: string[] = [];
  checkPage(query, problems);
  checkList('tipo', query.tipos, ACCOUNT_TYPES, problems);
  finish(problems);

  const params = pageParams(query);
  appendList(params, 'tipo', query.tipos);
  return params;
}

export function buildMovementsParams(query: MovementsQuery): URLSearchParams {
  const problems: string[] = [];
  checkPage(query, problems);
  checkPeriod(query, problems);
  checkIds('conta_id', query.contaIds, problems);
  checkOneOf('natureza', query.natureza, MOVEMENT_NATURES, problems);
  checkIds('origem', query.origens, problems, {
    min: MOVEMENT_ORIGIN_MIN,
    max: MOVEMENT_ORIGIN_MAX,
  });
  finish(problems);

  const params = pageParams(query);
  params.set('data_inicio', query.dataInicio);
  params.set('data_fim', query.dataFim);
  appendList(params, 'conta_id', query.contaIds);
  if (query.natureza !== undefined) {
    params.set('natureza', query.natureza);
  }
  appendList(params, 'origem', query.origens);
  if (query.conciliado !== undefined) {
    params.set('conciliado', query.conciliado ? '1' : '0');
  }
  return params;
}

export function buildStatementParams(query: StatementQuery): URLSearchParams {
  const problems: string[] = [];
  checkPage(query, problems);
  checkPeriod(query, problems);
  checkIds('conta_id', [query.contaId], problems);
  finish(problems);

  const params = pageParams(query);
  params.set('data_inicio', query.dataInicio);
  params.set('data_fim', query.dataFim);
  params.set('conta_id', String(query.contaId));
  return params;
}

export function buildInvoicesParams(query: InvoicesQuery): URLSearchParams {
  const problems: string[] = [];
  checkPage(query, problems);
  checkPeriod(query, problems);
  checkIds('razao_social_id', query.razaoSocialIds, problems);
  checkOneOf('situacao', query.situacao, INVOICE_STATUSES, problems);
  checkOneOf('operacao', query.operacao, INVOICE_OPERATIONS, problems);
  finish(problems);

  const params = pageParams(query);
  params.set('data_inicio', query.dataInicio);
  params.set('data_fim', query.dataFim);
  appendList(params, 'razao_social_id', query.razaoSocialIds);
  if (query.situacao !== undefined) {
    params.set('situacao', query.situacao);
  }
  if (query.operacao !== undefined) {
    params.set('operacao', query.operacao);
  }
  return params;
}

export function buildLegalEntitiesParams(query: LegalEntitiesQuery): URLSearchParams {
  const problems: string[] = [];
  checkPage(query, problems);
  finish(problems);
  return pageParams(query);
}

export function buildPeopleParams(query: PeopleQuery): URLSearchParams {
  const problems: string[] = [];
  checkPage(query, problems);
  if (query.busca !== undefined) {
    const busca = query.busca.trim();
    if (
      busca.length < SEARCH_MIN_LENGTH ||
      busca.length > SEARCH_MAX_LENGTH ||
      hasControlChars(busca)
    ) {
      problems.push(
        `busca deve ter de ${String(SEARCH_MIN_LENGTH)} a ${String(SEARCH_MAX_LENGTH)} caracteres, sem controle`,
      );
    }
  }
  finish(problems);

  const params = pageParams(query);
  if (query.busca !== undefined) {
    params.set('busca', query.busca.trim());
  }
  return params;
}
