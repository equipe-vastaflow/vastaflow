import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export type NewAuditLog = Pick<
  AuditLog,
  'usuarioId' | 'acao' | 'modulo' | 'descricao' | 'ip' | 'metadados'
>;

@Injectable()
export class AuditRepository {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  async create(data: NewAuditLog): Promise<void> {
    await this.repository.save(this.repository.create(data));
  }

  findLatest(limit: number): Promise<AuditLog[]> {
    return this.repository.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * Pagina de eventos, do mais recente para o mais antigo.
   *
   * O `id` desempata: varios eventos podem cair no mesmo instante (um login
   * gera registro junto de outras acoes), e sem um criterio estavel o mesmo
   * evento poderia aparecer em duas paginas - ou em nenhuma.
   */
  findPage(skip: number, take: number): Promise<[AuditLog[], number]> {
    return this.repository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip,
      take,
    });
  }

  /** `COUNT` no banco: nenhuma linha e carregada. */
  count(): Promise<number> {
    return this.repository.count();
  }
}
