import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from './entities/system-setting.entity';

export type NewSystemSetting = Pick<SystemSetting, 'chave' | 'valor' | 'descricao' | 'tipo'>;

@Injectable()
export class SettingsRepository {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly repository: Repository<SystemSetting>,
  ) {}

  /**
   * Todas as configuracoes, em UMA consulta.
   *
   * Sem paginacao: o catalogo e um conjunto fechado, definido em codigo, e nao
   * cresce com o uso do sistema. Ordem alfabetica para a listagem ser estavel.
   */
  findAll(): Promise<SystemSetting[]> {
    return this.repository.find({ order: { chave: 'ASC' } });
  }

  findByKey(chave: string): Promise<SystemSetting | null> {
    return this.repository.findOne({ where: { chave } });
  }

  create(data: NewSystemSetting): Promise<SystemSetting> {
    return this.repository.save(this.repository.create({ ...data, atualizadoPorId: null }));
  }

  save(setting: SystemSetting): Promise<SystemSetting> {
    return this.repository.save(setting);
  }
}
