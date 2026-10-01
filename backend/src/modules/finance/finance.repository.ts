import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { FinancialEntry } from './entities/financial-entry.entity';
import type { FinanceFilter } from './finance-filter';
import { FinancialEntryStatus, FinancialEntryType } from './financial-entry.enums';

export type NewFinancialEntry = Pick<
  FinancialEntry,
  'tipo' | 'descricao' | 'valor' | 'data' | 'categoria' | 'status' | 'observacao' | 'criadoPorId'
>;

/** Uma linha de um agrupamento: a chave, quantos lancamentos e a soma deles. */
export interface GroupedTotal<T extends string> {
  key: T;
  quantidade: number;
  valor: number;
}

/** Totais do conjunto filtrado, todos calculados no banco. */
export interface FilteredTotals {
  totalRegistros: number;
  totalReceitas: number;
  totalDespesas: number;
  saldo: number;
}

/** Posicao da ultima linha lida, para continuar de onde parou. */
export interface EntryCursor {
  data: string;
  id: string;
}

@Injectable()
export class FinanceRepository {
  constructor(
    @InjectRepository(FinancialEntry)
    private readonly repository: Repository<FinancialEntry>,
  ) {}

  findById(id: string): Promise<FinancialEntry | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Pagina de lancamentos, do mais recente para o mais antigo, aplicando o
   * recorte informado.
   *
   * O `id` desempata: varios lancamentos podem ter a mesma `data` (que e um dia,
   * sem hora), e sem criterio estavel o mesmo registro poderia aparecer em duas
   * paginas - ou em nenhuma. Mesmo cuidado ja aplicado na auditoria.
   *
   * Filtro vazio significa "tudo", como antes de os filtros existirem.
   */
  findPage(filter: FinanceFilter, skip: number, take: number): Promise<[FinancialEntry[], number]> {
    return this.filtered(filter)
      .orderBy('e.data', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  /** Os mais recentes, sem paginacao. Usado pelo resumo do comando `/financeiro`. */
  findLatest(limit: number): Promise<FinancialEntry[]> {
    return this.repository.find({ order: { data: 'DESC', id: 'DESC' }, take: limit });
  }

  /** `COUNT` no banco: nenhuma linha e carregada. */
  count(): Promise<number> {
    return this.repository.count();
  }

  /** `COUNT` do conjunto filtrado. Usado para decidir o limite da exportacao. */
  countFiltered(filter: FinanceFilter): Promise<number> {
    return this.filtered(filter).getCount();
  }

  /**
   * Total de registros, soma por natureza e saldo - em UMA consulta agregada.
   *
   * Nenhuma linha e carregada: o Node nunca soma dinheiro. Uma consulta so
   * garante que os quatro numeros venham do mesmo instante.
   *
   * O saldo e calculado no SQL, com sinal: `valor` e sempre positivo e quem diz
   * se o dinheiro entra ou sai e o `tipo`. `CANCELADO` fica fora do saldo (e das
   * somas por natureza) porque lancamento cancelado nao e dinheiro - mas segue
   * contando em `totalRegistros`, que descreve o conjunto filtrado.
   *
   * As comparacoes de `tipo`/`status` vao como parametro nomeado para o SQL
   * sair igual nos dois bancos.
   */
  async totals(filter: FinanceFilter): Promise<FilteredTotals> {
    const raw = await this.filtered(filter)
      .select('COUNT(1)', 'totalRegistros')
      .addSelect(
        `SUM(CASE WHEN e.tipo = :tReceita AND e.status <> :sCancelado THEN e.valor ELSE 0 END)`,
        'totalReceitas',
      )
      .addSelect(
        `SUM(CASE WHEN e.tipo = :tDespesa AND e.status <> :sCancelado THEN e.valor ELSE 0 END)`,
        'totalDespesas',
      )
      .setParameters({
        tReceita: FinancialEntryType.Receita,
        tDespesa: FinancialEntryType.Despesa,
        sCancelado: FinancialEntryStatus.Cancelado,
      })
      .getRawOne<Record<string, unknown>>();

    const totalReceitas = readMoney(raw?.totalReceitas);
    const totalDespesas = readMoney(raw?.totalDespesas);

    return {
      totalRegistros: readCount(raw?.totalRegistros),
      totalReceitas,
      totalDespesas,
      // Subtracao em centavos: evita o residuo de ponto flutuante que
      // `15000.1 - 9300.25` produziria em JS.
      saldo: roundMoney((Math.round(totalReceitas * 100) - Math.round(totalDespesas * 100)) / 100),
    };
  }

  /**
   * Agrupamento por uma coluna do recorte, com contagem e soma.
   *
   * `column` e escolhido por um tipo fechado, nunca por texto vindo de fora: a
   * coluna entra no SQL, e nao como parametro.
   */
  async groupedTotals<T extends string>(
    filter: FinanceFilter,
    column: 'status' | 'tipo' | 'categoria',
  ): Promise<GroupedTotal<T>[]> {
    const rows = await this.filtered(filter)
      .select(`e.${column}`, 'key')
      .addSelect('COUNT(1)', 'quantidade')
      .addSelect('SUM(e.valor)', 'valor')
      .groupBy(`e.${column}`)
      .orderBy(`e.${column}`, 'ASC')
      .getRawMany<Record<string, unknown>>();

    return rows.map((row) => ({
      key: String(row.key) as T,
      quantidade: readCount(row.quantidade),
      valor: readMoney(row.valor),
    }));
  }

  /**
   * Lote de lancamentos do recorte, para a exportacao.
   *
   * Pagina por CURSOR, e nao por `OFFSET`: a exportacao le varios lotes em
   * sequencia e, com offset, um lancamento inserido no meio deslocaria as
   * paginas seguintes - linhas repetidas ou puladas no arquivo. O cursor
   * `(data, id)` acompanha a mesma ordem da listagem e nao escorrega.
   *
   * `after` ausente devolve o primeiro lote.
   */
  findBatch(filter: FinanceFilter, take: number, after?: EntryCursor): Promise<FinancialEntry[]> {
    const query = this.filtered(filter)
      .orderBy('e.data', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .take(take);

    if (after) {
      // Comparacao em duas partes em vez de `(data, id) < (:d, :i)`: a sintaxe
      // de construtor de linha nao e igual nos dois bancos.
      query.andWhere('(e.data < :cursorData OR (e.data = :cursorData AND e.id < :cursorId))', {
        cursorData: after.data,
        cursorId: after.id,
      });
    }

    return query.getMany();
  }

  create(data: NewFinancialEntry): Promise<FinancialEntry> {
    return this.repository.save(this.repository.create(data));
  }

  save(entry: FinancialEntry): Promise<FinancialEntry> {
    return this.repository.save(entry);
  }

  /**
   * Base de toda consulta filtrada. Cada criterio so entra quando informado,
   * entao filtro vazio produz a consulta de antes.
   *
   * O periodo compara a coluna `data` (dia do lancamento/vencimento), inclusivo
   * nas duas pontas. NAO existe data de pagamento no modelo.
   */
  private filtered(filter: FinanceFilter): SelectQueryBuilder<FinancialEntry> {
    const query = this.repository.createQueryBuilder('e');

    if (filter.de !== undefined) {
      query.andWhere('e.data >= :de', { de: filter.de });
    }
    if (filter.ate !== undefined) {
      query.andWhere('e.data <= :ate', { ate: filter.ate });
    }
    if (filter.status !== undefined) {
      query.andWhere('e.status = :status', { status: filter.status });
    }
    if (filter.tipo !== undefined) {
      query.andWhere('e.tipo = :tipo', { tipo: filter.tipo });
    }
    if (filter.categoria !== undefined) {
      query.andWhere('e.categoria = :categoria', { categoria: filter.categoria });
    }

    return query;
  }
}

/**
 * Le um `COUNT` de resultado cru.
 *
 * Agregacao nao passa pelo transformer da entidade: o MySQL devolve `COUNT` como
 * string (`"42"`), outros drivers como number. Sem normalizar, a resposta da API
 * mudaria de tipo conforme o banco.
 */
function readCount(value: unknown): number {
  const numero = Number(value ?? 0);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Le uma soma de dinheiro de resultado cru, com duas casas.
 *
 * Mesmo motivo do `readCount`, e mais grave: o MySQL devolve `SUM` de DECIMAL
 * como string (`"1000.50"`) enquanto a entidade hidratada traz `number` - o
 * `moneyTransformer` nao alcanca `getRawOne`/`getRawMany`. `SUM` sem nenhuma
 * linha devolve `NULL`, que aqui vira zero.
 */
function readMoney(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const numero = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numero) ? roundMoney(numero) : 0;
}

/** Duas casas decimais, pelo mesmo criterio do `moneyTransformer`. */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
