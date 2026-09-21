import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';

@Injectable()
export class PermissionsRepository {
  constructor(
    @InjectRepository(Permission)
    private readonly repository: Repository<Permission>,
  ) {}

  findAll(): Promise<Permission[]> {
    return this.repository.find({ order: { code: 'ASC' } });
  }

  create(data: Pick<Permission, 'code' | 'descricao'>): Promise<Permission> {
    return this.repository.save(this.repository.create(data));
  }
}
