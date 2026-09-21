import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionCode } from '../permissions/permission-code.enum';
import { toUserResponse, UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(PermissionCode.UsersRead)
  @ApiOperation({
    summary: 'Lista os usuarios',
    description:
      'Exige a permissao `users:read` (ADMIN e GESTOR por padrao). ' +
      'Serve como primeiro exemplo de rota protegida por RBAC.',
  })
  @ApiOkResponse({ type: [UserResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
  @ApiForbiddenResponse({ description: 'Perfil sem a permissao necessaria' })
  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.usersService.findAll();
    return users.map(toUserResponse);
  }
}
