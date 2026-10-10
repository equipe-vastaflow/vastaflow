import { PlantaeInputError } from './plantae-errors';
import {
  ACCOUNT_TYPES,
  ENTRY_KINDS,
  ENTRY_STATUSES,
  INVOICE_OPERATIONS,
  INVOICE_STATUSES,
  MOVEMENT_NATURES,
  type AccountsQuery,
  type AccountType,
  type EntriesQuery,
  type EntryKind,
  type EntryStatus,
  type InvoiceOperation,
  type InvoiceStatus,
  type InvoicesQuery,
  type LegalEntitiesQuery,
  type MovementNature,
  type MovementsQuery,
  type PageOptions,
  type PeopleQuery,
  type StatementQuery,
} from './plantae-query';

/**
 * Parametros BRUTOS da query string -> filtros tipados.
 *
 * So converte e rejeita o que nao e do formato (texto onde se espera inteiro,
 * parametro desconhecido, valor repetido onde so cabe um). As regras de valor
 * - periodo de 366 dias, intervalos, tamanhos - ficam em `plantae-query.ts`, que
 * o servico executa de qualquer forma: assim a regra existe em UM lugar.
 *
 * Aceita as duas grafias de lista que a colecao documenta: `campo=1&campo=2` e
 * `campo[]=1&campo[]=2` (o Express 5 entrega a segunda com o `[]` no nome).
 *
 * Os nomes sao os da API do Plantae (`data_inicio`, `pessoa_id`...), mais
 * `paginas` (quantas paginas ler) que e do VastaFlow.
 */

type RawQuery = Readonly<Record<string, unknown>>;

class Params {
  private readonly values = new Map<string, string[]>();
  private readonly seen = new Set<string>();
  readonly problems: string[] = [];

  constructor(raw: RawQuery) {
    for (const [key, value] of Object.entries(raw)) {
      const name = key.endsWith('[]') ? key.slice(0, -2) : key;
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
        this.problems.push(`${safeName(name)} deve ser texto`);
        continue;
      }
      this.values.set(name, [...(this.values.get(name) ?? []), ...(list as string[])]);
    }
  }

  private take(name: string): string[] | undefined {
    this.seen.add(name);
    return this.values.get(name);
  }

  one(name: string): string | undefined {
    const values = this.take(name);
    if (values === undefined) {
      return undefined;
    }
    if (values.length !== 1) {
      this.problems.push(`${name} aceita um unico valor`);
      return undefined;
    }
    return values[0];
  }

  required(name: string): string | undefined {
    const value = this.one(name);
    if (value === undefined && !this.values.has(name)) {
      this.problems.push(`${name} e obrigatorio`);
    }
    return value;
  }

  private toInt(name: string, text: string): number | undefined {
    if (!/^\d{1,15}$/.test(text)) {
      this.problems.push(`${name} deve ser um inteiro`);
      return undefined;
    }
    return Number(text);
  }

  int(name: string): number | undefined {
    const text = this.one(name);
    return text === undefined ? undefined : this.toInt(name, text);
  }

  requiredInt(name: string): number | undefined {
    const text = this.required(name);
    return text === undefined ? undefined : this.toInt(name, text);
  }

  ints(name: string): number[] | undefined {
    const values = this.take(name);
    if (values === undefined) {
      return undefined;
    }
    const parsed = values.map((text) => this.toInt(name, text));
    return parsed.every((value): value is number => value !== undefined) ? parsed : undefined;
  }

  oneOf<T extends string>(name: string, allowed: readonly T[]): T | undefined {
    const text = this.one(name);
    if (text === undefined) {
      return undefined;
    }
    const match = allowed.find((value) => value === text);
    if (match === undefined) {
      this.problems.push(`${name} invalido`);
    }
    return match;
  }

  listOf<T extends number>(name: string, allowed: readonly T[]): T[] | undefined {
    const values = this.ints(name);
    if (values === undefined) {
      return undefined;
    }
    const matched = values.filter((value): value is T => allowed.some((item) => item === value));
    if (matched.length !== values.length) {
      this.problems.push(`${name} invalido`);
    }
    return matched;
  }

  boolean(name: string): boolean | undefined {
    const text = this.one(name);
    if (text === undefined) {
      return undefined;
    }
    if (text === '1' || text === 'true') {
      return true;
    }
    if (text === '0' || text === 'false') {
      return false;
    }
    this.problems.push(`${name} deve ser 1, 0, true ou false`);
    return undefined;
  }

  page(): PageOptions {
    const perPage = this.int('per_page');
    const cursor = this.one('cursor');
    const maxPages = this.int('paginas');
    return {
      ...(perPage === undefined ? {} : { perPage }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(maxPages === undefined ? {} : { maxPages }),
    };
  }

  /** Falha com todos os problemas acumulados, inclusive parametros desconhecidos. */
  finish(): void {
    for (const name of this.values.keys()) {
      if (!this.seen.has(name)) {
        this.problems.push(`parametro desconhecido: ${safeName(name)}`);
      }
    }
    if (this.problems.length > 0) {
      throw new PlantaeInputError(this.problems);
    }
  }
}

/** O nome de um parametro vem do cliente: so e repetido de volta se for um nome plausivel. */
function safeName(name: string): string {
  return /^[a-z_]{1,40}$/.test(name) ? name : '(nome invalido)';
}

/** Define so as chaves com valor: o `build*` nao ve `undefined` onde espera ausencia. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function parseEntriesQuery(raw: RawQuery): EntriesQuery {
  const p = new Params(raw);
  const page = p.page();
  const dataInicio = p.required('data_inicio');
  const dataFim = p.required('data_fim');
  const query = defined({
    ...page,
    dataInicio,
    dataFim,
    tipo: p.oneOf<EntryKind>('tipo', ENTRY_KINDS),
    status: p.listOf<EntryStatus>('status', ENTRY_STATUSES),
    pessoaIds: p.ints('pessoa_id'),
    razaoSocialIds: p.ints('razao_social_id'),
  });
  p.finish();
  return query as EntriesQuery;
}

export function parseAccountsQuery(raw: RawQuery): AccountsQuery {
  const p = new Params(raw);
  const query = defined({ ...p.page(), tipos: p.listOf<AccountType>('tipo', ACCOUNT_TYPES) });
  p.finish();
  return query;
}

export function parseMovementsQuery(raw: RawQuery): MovementsQuery {
  const p = new Params(raw);
  const page = p.page();
  const dataInicio = p.required('data_inicio');
  const dataFim = p.required('data_fim');
  const query = defined({
    ...page,
    dataInicio,
    dataFim,
    contaIds: p.ints('conta_id'),
    natureza: p.oneOf<MovementNature>('natureza', MOVEMENT_NATURES),
    origens: p.ints('origem'),
    conciliado: p.boolean('conciliado'),
  });
  p.finish();
  return query as MovementsQuery;
}

export function parseStatementQuery(raw: RawQuery): StatementQuery {
  const p = new Params(raw);
  const page = p.page();
  const dataInicio = p.required('data_inicio');
  const dataFim = p.required('data_fim');
  const contaId = p.requiredInt('conta_id');
  const query = defined({ ...page, dataInicio, dataFim, contaId });
  p.finish();
  return query as StatementQuery;
}

export function parseInvoicesQuery(raw: RawQuery): InvoicesQuery {
  const p = new Params(raw);
  const page = p.page();
  const dataInicio = p.required('data_inicio');
  const dataFim = p.required('data_fim');
  const query = defined({
    ...page,
    dataInicio,
    dataFim,
    razaoSocialIds: p.ints('razao_social_id'),
    situacao: p.oneOf<InvoiceStatus>('situacao', INVOICE_STATUSES),
    operacao: p.oneOf<InvoiceOperation>('operacao', INVOICE_OPERATIONS),
  });
  p.finish();
  return query as InvoicesQuery;
}

export function parseLegalEntitiesQuery(raw: RawQuery): LegalEntitiesQuery {
  const p = new Params(raw);
  const query = p.page();
  p.finish();
  return query;
}

export function parsePeopleQuery(raw: RawQuery): PeopleQuery {
  const p = new Params(raw);
  const query = defined({ ...p.page(), busca: p.one('busca') });
  p.finish();
  return query;
}
