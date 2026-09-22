import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '../../permissions/permission-code.enum';
import type { AuthenticatedRequest } from '../auth.types';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { hasPermission } from '../has-permission';

/**
 * Guard global de autorizacao por permissao granular. Roda depois do
 * `JwtAuthGuard`.
 *
 * - Rota sem `@RequirePermissions`: nao restringe.
 * - ADMIN: acesso total.
 * - Demais: o perfil precisa possuir TODAS as permissoes exigidas.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (required.every((permission) => hasPermission(user, permission))) {
      return true;
    }

    throw new ForbiddenException('Voce nao tem permissao para esta acao');
  }
}
