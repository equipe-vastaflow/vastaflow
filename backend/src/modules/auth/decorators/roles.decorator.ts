import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '../../roles/role-name.enum';

export const ROLES_KEY = 'auth:roles';

/**
 * Restringe a rota aos perfis informados (o usuario precisa ter UM deles).
 * ADMIN sempre tem acesso, mesmo sem constar na lista.
 */
export const Roles = (...roles: RoleName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
