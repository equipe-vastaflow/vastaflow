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

  /** `COUNT` no banco: nenhuma linha e carregada. */
  count(): Promise<number> {
    return this.repository.count();
  }
}
