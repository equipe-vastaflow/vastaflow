import { Logger } from '@nestjs/common';
import type { ConfigReader } from '../integration-config';
import { PlantaeApiError } from './plantae-errors';
import type { PlantaeHttpClient } from './plantae-http.client';
import type { Decimal } from './plantae-json';
import {
  type AccountsQuery,
  buildAccountsParams,
  buildEntriesParams,
  buildInvoicesParams,
  buildLegalEntitiesParams,
  buildMeParams,
  buildMovementsParams,
  buildPeopleParams,
  buildStatementParams,
  effectiveMaxPages,
  type EntriesQuery,
  type InvoicesQuery,
  type LegalEntitiesQuery,
  type MovementsQuery,
  type PageOptions,
  type PeopleQuery,
  type StatementQuery,
} from './plantae-query';
import { resolvePlantaeSettings } from './plantae-settings';
import { MAX_ITEMS_PER_CALL, PlantaeEndpoint, type PlantaeEndpointPath } from './plantae.constants';
import {
  type ParsedList,
  parseAccounts,
  parseEntries,
  parseIntegration,
  parseIssuedInvoices,
  parseLegalEntities,
  parseMovements,
  parsePeople,
  parseStatement,
  type RawPagination,
} from './plantae.parsers';
import type {
  PlantaeAccount,
  PlantaeEntry,
  PlantaeIntegration,
  PlantaeIssuedInvoice,
  PlantaeLegalEntity,
  PlantaeMovement,
  PlantaePage,
  PlantaePagination,
  PlantaePerson,
  PlantaeStatementPage,
} from './plantae.types';

interface Resolved {
  readonly nextCursor: string | null;
  readonly hasMore: boolean | null;
}

/**
 * Consultas ao Plantae: filtros validados -> cliente HTTP -> resposta validada.
 *
 * SOMENTE leitura. Nao ha metodo de escrita porque a API nao tem rota de escrita.
 * Nada e gravado: o resultado vive na memoria da requisicao.
 *
 * Paginacao:
 * - cada chamada le de 1 a `MAX_PAGES_PER_CALL` paginas (padrao: UMA). Nao ha
 *   coleta integral: quem quer mais passa `nextCursor` na chamada seguinte;
 * - o cursor e OPACO e usado exatamente como veio. Se a resposta repetir um
 *   cursor ja usado, e `cursor-loop`, nao um laco infinito;
 * - `links.next` NUNCA e seguido como destino. Quando validado (https, host e
 *   caminho do proprio Plantae), serve so para conferir consistencia e, se
 *   `meta` nao existir, para ler o parametro `cursor` dele;
 * - `hasMore: null` significa "a API nao informou": o servico nunca afirma que a
 *   lista acabou sem que a API tenha dito.
 *
 * Log: so o endpoint, o resultado, a quantidade e a categoria da falha. Nenhum
 * filtro, nenhum dado de pessoa, nenhum valor financeiro.
 */
export class PlantaeService {
  private readonly logger = new Logger(PlantaeService.name);

  constructor(
    private readonly client: PlantaeHttpClient,
    private readonly config: ConfigReader,
  ) {}

  async getMe(): Promise<PlantaeIntegration> {
    const endpoint = PlantaeEndpoint.Me;
    return this.observe(endpoint, async () => {
      const result = parseIntegration(await this.client.get(endpoint, buildMeParams()));
      return { value: result, pages: 1, items: 1 };
    });
  }

  listEntries(query: EntriesQuery): Promise<PlantaePage<PlantaeEntry>> {
    return this.list(
      PlantaeEndpoint.FinancialEntries,
      () => buildEntriesParams(query),
      query,
      parseEntries,
    );
  }

  listAccounts(query: AccountsQuery): Promise<PlantaePage<PlantaeAccount>> {
    return this.list(
      PlantaeEndpoint.FinancialAccounts,
      () => buildAccountsParams(query),
      query,
      parseAccounts,
    );
  }

  listMovements(query: MovementsQuery): Promise<PlantaePage<PlantaeMovement>> {
    return this.list(
      PlantaeEndpoint.FinancialMovements,
      () => buildMovementsParams(query),
      query,
      parseMovements,
    );
  }

  listIssuedInvoices(query: InvoicesQuery): Promise<PlantaePage<PlantaeIssuedInvoice>> {
    return this.list(
      PlantaeEndpoint.FiscalIssuedInvoices,
      () => buildInvoicesParams(query),
      query,
      parseIssuedInvoices,
    );
  }

  listLegalEntities(query: LegalEntitiesQuery): Promise<PlantaePage<PlantaeLegalEntity>> {
    return this.list(
      PlantaeEndpoint.OrganizationLegalEntities,
      () => buildLegalEntitiesParams(query),
      query,
      parseLegalEntities,
    );
  }

  listPeople(query: PeopleQuery): Promise<PlantaePage<PlantaePerson>> {
    return this.list(PlantaeEndpoint.People, () => buildPeopleParams(query), query, parsePeople);
  }

  /**
   * Extrato de uma conta. `saldoAnterior` e `saldoFinal` sao do PERIODO inteiro
   * e identicos em todas as paginas: sao lidos, conferidos entre si e devolvidos
   * como vieram. Nunca se calcula saldo a partir das linhas de uma pagina.
   */
  async getAccountStatement(query: StatementQuery): Promise<PlantaeStatementPage> {
    let balances: { anterior: Decimal; final: Decimal } | undefined;
    const page = await this.list<PlantaeMovement, ReturnType<typeof parseStatement>>(
      PlantaeEndpoint.FinancialAccountStatement,
      () => buildStatementParams(query),
      query,
      parseStatement,
      (parsed) => {
        if (
          balances !== undefined &&
          (balances.anterior !== parsed.saldoAnterior || balances.final !== parsed.saldoFinal)
        ) {
          throw new PlantaeApiError('invalid-response', {
            where: 'meta.saldo [diferente entre paginas]',
          });
        }
        balances = { anterior: parsed.saldoAnterior, final: parsed.saldoFinal };
      },
    );
    if (balances === undefined) {
      throw new PlantaeApiError('invalid-response', { where: 'meta.saldo [ausente]' });
    }
    return { ...page, saldoAnterior: balances.anterior, saldoFinal: balances.final };
  }

  // --- internos -------------------------------------------------------------

  private async list<T, P extends ParsedList<T>>(
    endpoint: PlantaeEndpointPath,
    buildParams: () => URLSearchParams,
    page: PageOptions,
    parse: (body: unknown) => P,
    onPage?: (parsed: P) => void,
  ): Promise<PlantaePage<T>> {
    // Valida os filtros ANTES de qualquer chamada externa (e fora do log de falhas do Plantae).
    const baseParams = buildParams();
    return this.observe(endpoint, async () => {
      const maxPages = effectiveMaxPages(page);
      const items: T[] = [];
      const used = new Set<string>();
      let cursor = page.cursor;
      if (cursor !== undefined) {
        used.add(cursor);
      }
      let pages = 0;

      for (;;) {
        const params = new URLSearchParams(baseParams);
        if (cursor !== undefined) {
          params.set('cursor', cursor);
        }
        const parsed = parse(await this.client.get(endpoint, params));
        onPage?.(parsed);
        pages += 1;
        items.push(...parsed.items);
        const resolved = this.resolvePagination(endpoint, parsed.pagination);

        const next = resolved.nextCursor;
        if (next !== null && used.has(next)) {
          throw new PlantaeApiError('cursor-loop');
        }
        if (next === null || pages >= maxPages || items.length >= MAX_ITEMS_PER_CALL) {
          const pagination: PlantaePagination = {
            perPage: parsed.pagination.perPage,
            nextCursor: next,
            hasMore: resolved.hasMore,
            pagesFetched: pages,
          };
          return { value: { items, pagination }, pages, items: items.length };
        }
        used.add(next);
        cursor = next;
      }
    });
  }

  /**
   * Interpreta `meta`/`links`. Preferencia pelo `meta.next_cursor`; `links.next`
   * so confere (e, sem `meta`, fornece o cursor).
   */
  private resolvePagination(endpoint: PlantaeEndpointPath, raw: RawPagination): Resolved {
    const fromLink = raw.nextLink === null ? null : this.cursorFromLink(endpoint, raw.nextLink);

    if (raw.nextCursor !== null && fromLink !== null && raw.nextCursor !== fromLink) {
      throw new PlantaeApiError('pagination-inconsistent', {
        where: 'links.next x meta.next_cursor',
      });
    }
    if (raw.hasLinks && raw.hasMeta && (raw.nextLink === null) !== (raw.nextCursor === null)) {
      throw new PlantaeApiError('pagination-inconsistent', {
        where: 'links.next x meta.next_cursor',
      });
    }
    const nextCursor = raw.nextCursor ?? fromLink;
    if (raw.nextLink !== null && nextCursor === null) {
      throw new PlantaeApiError('pagination-inconsistent', { where: 'links.next sem cursor' });
    }
    if (!raw.hasLinks && !raw.hasMeta) {
      return { nextCursor: null, hasMore: null };
    }
    return { nextCursor, hasMore: nextCursor !== null };
  }

  /**
   * Valida `links.next` e le o parametro `cursor` dele. NAO segue o link.
   *
   * O link tem de ser do proprio Plantae: https, mesmo host da URL base, sem
   * credencial e no caminho exato do endpoint consultado. Qualquer outro destino
   * e `invalid-response`.
   */
  private cursorFromLink(endpoint: PlantaeEndpointPath, link: string): string | null {
    const settings = resolvePlantaeSettings(this.config);
    if (settings.baseUrl === null) {
      throw new PlantaeApiError('not-configured');
    }
    const base = new URL(settings.baseUrl);
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new PlantaeApiError('invalid-response', { where: 'links.next [url]' });
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== base.hostname ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname.replace(/\/+$/, '') !== `${base.pathname}${endpoint}`
    ) {
      throw new PlantaeApiError('invalid-response', { where: 'links.next [destino]' });
    }
    const cursor = url.searchParams.get('cursor');
    return cursor === null || cursor === '' ? null : cursor;
  }

  /** Mede, registra o resultado (sem dado de negocio) e repassa o erro. */
  private async observe<V>(
    endpoint: PlantaeEndpointPath,
    run: () => Promise<{ value: V; pages: number; items: number }>,
  ): Promise<V> {
    const name = endpoint.slice(1);
    const started = Date.now();
    try {
      const { value, pages, items } = await run();
      this.logger.log(
        `Plantae GET ${name} ok paginas=${String(pages)} itens=${String(items)} ` +
          `${String(Date.now() - started)}ms`,
      );
      return value;
    } catch (error) {
      if (error instanceof PlantaeApiError) {
        this.logger.warn(`Plantae GET ${name} ${error.message} ${String(Date.now() - started)}ms`);
      }
      throw error;
    }
  }
}
