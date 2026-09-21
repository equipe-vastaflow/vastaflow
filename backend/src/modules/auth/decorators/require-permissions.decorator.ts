import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../../permissions/permission-code.enum';

export const PERMISSIONS_KEY = 'auth:permissions';

/**
 * Exige TODAS as permissoes informadas. ADMIN sempre tem acesso.
 *
 * Prefira este decorator a `@Roles` em rotas novas: ele desacopla a rota de
 * quem pode acessa-la, e o vinculo perfil/permissao pode mudar no banco sem
 * alterar o codigo.
 */
export const RequirePermissions = (
  ...permissions: PermissionCode[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);
