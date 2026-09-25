import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionCode } from '../permissions/permission-code.enum';
import { UpdateSettingDto } from './dto/update-setting.dto';
import {
  toSystemSettingResponse,
  SystemSettingResponseDto,
} from './dto/system-setting-response.dto';
import { SettingsService } from './settings.service';

/**
 * Configuracoes internas do sistema.
 *
 * Nenhuma rota e publica: todas exigem JWT (guard global) e uma permissao
 * granular. Nao ha `POST` nem `DELETE` - as chaves vem do catalogo em codigo,
 * semeadas no boot; pela API so o valor muda.
 *
 * A chave e o identificador na URL, e o responsavel pela alteracao vem sempre
 * do usuario autenticado - nenhum identificador de usuario e aceito no corpo.
 */
@ApiTags('Settings')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@ApiForbiddenResponse({ description: 'Perfil sem a permissao necessaria' })
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequirePermissions(PermissionCode.SettingsRead)
  @ApiOperation({
    summary: 'Lista as configuracoes do sistema',
    description:
      'Exige `settings:read`. Sem paginacao: o catalogo e um conjunto fechado definido em ' +
      'codigo. Ordenado pela chave.',
  })
  @ApiOkResponse({ type: [SystemSettingResponseDto] })
  async findAll(): Promise<SystemSettingResponseDto[]> {
    const settings = await this.settingsService.list();
    return settings.map(toSystemSettingResponse);
  }

  @Get(':key')
  @RequirePermissions(PermissionCode.SettingsRead)
  @ApiOperation({ summary: 'Consulta uma configuracao', description: 'Exige `settings:read`.' })
  @ApiParam({ name: 'key', example: 'SYSTEM_NAME' })
  @ApiOkResponse({ type: SystemSettingResponseDto })
  @ApiNotFoundResponse({ description: 'Configuracao nao encontrada' })
  async findOne(@Param('key') key: string): Promise<SystemSettingResponseDto> {
    return toSystemSettingResponse(await this.settingsService.get(key));
  }

  @Patch(':key')
  @RequirePermissions(PermissionCode.SettingsUpdate)
  @ApiOperation({
    summary: 'Altera o valor de uma configuracao',
    description:
      'Exige `settings:update`. Somente o valor muda: chave, tipo e descricao vem do ' +
      'catalogo e sao recusados com 400 por estarem fora do DTO. O valor precisa ' +
      'corresponder ao `tipo` declarado - nao ha conversao de texto para numero ou booleano.',
  })
  @ApiParam({ name: 'key', example: 'SYSTEM_NAME' })
  @ApiOkResponse({ type: SystemSettingResponseDto })
  @ApiBadRequestResponse({ description: 'Valor incompativel com o tipo da configuracao' })
  @ApiNotFoundResponse({ description: 'Configuracao nao encontrada' })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @ClientIp() ip: string | null,
  ): Promise<SystemSettingResponseDto> {
    return toSystemSettingResponse(await this.settingsService.update(actor, key, dto.valor, ip));
  }
}
