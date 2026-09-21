import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { Permission } from '../permissions/entities/permission.entity';
import type { Role } from './entities/role.entity';
import type { RoleName } from './role-name.enum';
import { RolesRepository } from './roles.repository';

@Injectable()
export class RolesService {
  constructor(private readonly rolesRepository: RolesRepository) {}

  findAll(): Promise<Role[]> {
    return this.rolesRepository.findAll();
  }

  findByName(nome: RoleName): Promise<Role | null> {
    return this.rolesRepository.findByName(nome);
  }

  /**
   * Os perfis sao criados pelo seeder no boot. Se um deles nao existe, e um
   * problema de implantacao (nao do cliente), por isso e um erro 500.
   */
  async getByName(nome: RoleName): Promise<Role> {
    const role = await this.rolesRepository.findByName(nome);
    if (!role) {
      throw new InternalServerErrorException(
        `Perfil ${nome} nao encontrado; o seed foi executado?`,
      );
    }
    return role;
  }

  create(nome: RoleName, descricao: string, permissions: Permission[]): Promise<Role> {
    return this.rolesRepository.create(nome, descricao, permissions);
  }

  /** Acrescenta permissoes ao perfil, ignorando as que ele ja possui. */
  async addPermissions(role: Role, permissions: Permission[]): Promise<Role> {
    const owned = new Set(role.permissions.map((permission) => permission.id));
    const missing = permissions.filter((permission) => !owned.has(permission.id));
    if (missing.length === 0) {
      return role;
    }
    role.permissions = [...role.permissions, ...missing];
    return this.rolesRepository.save(role);
  }
}
