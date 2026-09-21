import { Injectable } from '@nestjs/common';
import type { Permission } from './entities/permission.entity';
import { PermissionsRepository } from './permissions.repository';

@Injectable()
export class PermissionsService {
  constructor(private readonly permissionsRepository: PermissionsRepository) {}

  findAll(): Promise<Permission[]> {
    return this.permissionsRepository.findAll();
  }

  create(code: string, descricao: string): Promise<Permission> {
    return this.permissionsRepository.create({ code, descricao });
  }
}
