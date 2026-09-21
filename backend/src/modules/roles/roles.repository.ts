import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Permission } from '../permissions/entities/permission.entity';
import { Role } from './entities/role.entity';
import type { RoleName } from './role-name.enum';

@Injectable()
export class RolesRepository {
  constructor(
    @InjectRepository(Role)
    private readonly repository: Repository<Role>,
  ) {}

  findAll(): Promise<Role[]> {
    return this.repository.find({ relations: { permissions: true } });
  }

  findByName(nome: RoleName): Promise<Role | null> {
    return this.repository.findOne({ where: { nome }, relations: { permissions: true } });
  }

  create(nome: RoleName, descricao: string, permissions: Permission[]): Promise<Role> {
    return this.repository.save(this.repository.create({ nome, descricao, permissions }));
  }

  save(role: Role): Promise<Role> {
    return this.repository.save(role);
  }
}
