import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionCode } from '../permissions/permission-code.enum';
import { RoleName } from '../roles/role-name.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { DEFAULT_PAGE_SIZE, ListUsersQuery } from './dto/list-users.query';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPageResponseDto } from './dto/user-page-response.dto';
import { toUserResponse, UserResponseDto } from './dto/user-response.dto';
import { UserManagementService } from './user-management.service';

const HIERARCHY_RULE =
  'Quem nao e ADMIN so gerencia usuarios - e so concede perfis - com menos permissoes que as suas.';

/**
 * Administracao de usuarios. Nenhuma rota e publica: todas exigem JWT (guard
 * global) e uma permissao granular. As regras que dependem do usuario-alvo
 * (hierarquia, ultimo ADMIN, auto-alteracao) ficam no `UserManagementService`.
 */
@ApiTags('Users')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@ApiForbiddenResponse({ description: 'Sem a permissao necessaria, ou alvo fora do seu alcance' })
@Controller('users')
export class UsersController {
  constructor(private readonly userManagement: UserManagementService) {}

  @Get()
  @RequirePermissions(PermissionCode.UsersRead)
  @ApiOperation({
    summary: 'Lista os usuarios, paginado e ordenado por nome',
    description: 'Exige `users:read`.',
  })
  @ApiOkResponse({ type: UserPageResponseDto })
  @ApiBadRequestResponse({ description: 'Parametros de paginacao invalidos' })
  async findPage(@Query() query: ListUsersQuery): Promise<UserPageResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const { items, total } = await this.userManagement.list(page, limit);
    return { items: items.map(toUserResponse), total, page, limit };
  }

  // Antes de `:id`, para `assignable-roles` nao ser lido como um id.
  @Get('assignable-roles')
  @RequirePermissions(PermissionCode.UsersRead)
  @ApiOperation({
    summary: 'Perfis que o usuario autenticado pode conceder',
    description:
      'Sao tambem os perfis dos usuarios que ele pode gerenciar. Permite ao frontend refletir ' +
      `as regras do backend sem duplica-las. ${HIERARCHY_RULE}`,
  })
  @ApiOkResponse({
    schema: { type: 'array', items: { type: 'string', enum: Object.values(RoleName) } },
  })
  assignableRoles(@CurrentUser() actor: AuthenticatedUser): Promise<RoleName[]> {
    return this.userManagement.assignableRoles(actor);
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.UsersRead)
  @ApiOperation({ summary: 'Consulta um usuario', description: 'Exige `users:read`.' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Id nao e um UUID' })
  @ApiNotFoundResponse({ description: 'Usuario nao encontrado' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return toUserResponse(await this.userManagement.get(id));
  }

  @Post()
  @RequirePermissions(PermissionCode.UsersCreate)
  @ApiOperation({
    summary: 'Cria um usuario ativo',
    description: `Exige \`users:create\`. ${HIERARCHY_RULE}`,
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Dados invalidos (e-mail, nome, senha fora da politica)' })
  @ApiConflictResponse({ description: 'E-mail ja cadastrado' })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateUserDto,
    @ClientIp() ip: string | null,
  ): Promise<UserResponseDto> {
    return toUserResponse(await this.userManagement.create(actor, dto, ip));
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.UsersUpdate)
  @ApiOperation({
    summary: 'Edita nome e e-mail',
    description:
      'Exige `users:update`. Nao altera senha, perfil nem status (campos recusados com 400). ' +
      `O proprio usuario pode editar os seus dados. ${HIERARCHY_RULE}`,
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Dados invalidos ou campo nao permitido' })
  @ApiNotFoundResponse({ description: 'Usuario nao encontrado' })
  @ApiConflictResponse({ description: 'E-mail ja cadastrado' })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @ClientIp() ip: string | null,
  ): Promise<UserResponseDto> {
    return toUserResponse(await this.userManagement.update(actor, id, dto, ip));
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionCode.UsersStatus)
  @ApiOperation({
    summary: 'Ativa ou desativa um usuario',
    description:
      'Exige `users:status`. A desativacao vale imediatamente, inclusive para tokens ja emitidos. ' +
      `Ninguem altera o proprio status. ${HIERARCHY_RULE}`,
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario nao encontrado' })
  @ApiConflictResponse({ description: 'Desativaria o ultimo ADMIN ativo' })
  async setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @ClientIp() ip: string | null,
  ): Promise<UserResponseDto> {
    return toUserResponse(await this.userManagement.setStatus(actor, id, dto.ativo, ip));
  }

  @Patch(':id/role')
  @RequirePermissions(PermissionCode.UsersRole)
  @ApiOperation({
    summary: 'Altera o perfil de um usuario',
    description: `Exige \`users:role\`. Ninguem altera o proprio perfil. ${HIERARCHY_RULE}`,
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario nao encontrado' })
  @ApiConflictResponse({ description: 'Removeria o ultimo ADMIN ativo' })
  async setRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @ClientIp() ip: string | null,
  ): Promise<UserResponseDto> {
    return toUserResponse(await this.userManagement.setRole(actor, id, dto.role, ip));
  }
}
