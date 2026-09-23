import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancialEntry } from './entities/financial-entry.entity';

export type NewFinancialEntry = Pick<
  FinancialEntry,
  'tipo' | 'descricao' | 'valor' | 'data' | 'categoria' | 'status' | 'observacao' | 'criadoPorId'
>;

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
   * Pagina de lancamentos, do mais recente para o mais antigo.
   *
   * O `id` desempata: varios lancamentos podem ter a mesma `data` (que e um dia,
   * sem hora), e sem criterio estavel o mesmo registro poderia aparecer em duas
   * paginas - ou em nenhuma. Mesmo cuidado ja aplicado na auditoria.
   */
  findPage(skip: number, take: number): Promise<[FinancialEntry[], number]> {
    return this.repository.findAndCount({
      order: { data: 'DESC', id: 'DESC' },
      skip,
      take,
    });
  }

  /** Os mais recentes, sem paginacao. Usado pelo resumo do comando `/financeiro`. */
  findLatest(limit: number): Promise<FinancialEntry[]> {
    return this.repository.find({ order: { data: 'DESC', id: 'DESC' }, take: limit });
  }

  /** `COUNT` no banco: nenhuma linha e carregada. */
  count(): Promise<number> {
    return this.repository.count();
  }

  create(data: NewFinancialEntry): Promise<FinancialEntry> {
    return this.repository.save(this.repository.create(data));
  }

  save(entry: FinancialEntry): Promise<FinancialEntry> {
    return this.repository.save(entry);
  }
}
