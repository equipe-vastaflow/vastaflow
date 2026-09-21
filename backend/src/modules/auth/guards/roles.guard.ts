import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '../../roles/role-name.enum';
import type { AuthenticatedRequest } from '../auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Guard global de autorizacao por perfil (RBAC). Roda depois do `JwtAuthGuard`.
 *
 * - Rota sem `@Roles`: nao restringe.
 * - ADMIN: acesso total.
 * - Demais: o perfil do usuario precisa estar na lista.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    // Sem usuario aqui significa `@Roles` numa rota `@Public()`: erro de
    // configuracao, e o caminho seguro e negar.
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user && (user.role === RoleName.Admin || required.includes(user.role))) {
      return true;
    }

    throw new ForbiddenException('Acesso negado para o seu perfil');
  }
}
