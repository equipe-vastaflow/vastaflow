import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import {
  ExternalIdentityResponseDto,
  toExternalIdentityResponse,
} from './dto/external-identity-response.dto';
import {
  CreatedLinkRequestResponseDto,
  CreateLinkRequestDto,
  LinkRequestResponseDto,
  toCreatedLinkRequestResponse,
  toLinkRequestResponse,
} from './dto/link-request.dto';
import { ExternalIdentitiesService } from './external-identities.service';

const HIERARCHY_RULE =
  'Mesma regra da edicao de usuarios: quem nao e ADMIN so gerencia usuarios com menos ' +
  'permissoes que as suas; o proprio usuario pode gerenciar os seus vinculos.';

/**
 * Vinculos de identidade externa de um usuario (ex.: conta do Telegram).
 *
 * A API NAO cria vinculo ativo diretamente. Ela inicia uma SOLICITACAO com um
 * codigo de uso unico; o vinculo so passa a existir quando a propria conta
 * externa envia o codigo ao bot (prova de posse). Nenhum id externo e aceito
 * aqui.
 *
 * Permissoes existentes: consultar exige `users:read`; iniciar, cancelar e
 * desvincular exigem `users:update`, com a hierarquia da edicao de usuarios.
 */
@ApiTags('Users')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@ApiForbiddenResponse({ description: 'Sem a permissao necessaria, ou alvo fora do seu alcance' })
@Controller('users/:id/external-identities')
export class ExternalIdentitiesController {
  constructor(private readonly service: ExternalIdentitiesService) {}

  @Get()
  @RequirePermissions(PermissionCode.UsersRead)
  @ApiOperation({
    summary: 'Lista os vinculos ATIVOS de identidade externa do usuario',
    description: 'Exige `users:read`. Solicitacoes pendentes nao aparecem aqui.',
  })
  @ApiOkResponse({ type: [ExternalIdentityResponseDto] })
  @ApiNotFoundResponse({ description: 'Usuario nao encontrado' })
  async findAll(@Param('id', ParseUUIDPipe) id: string): Promise<ExternalIdentityResponseDto[]> {
    return (await this.service.list(id)).map(toExternalIdentityResponse);
  }

  @Get('link-requests')
  @RequirePermissions(PermissionCode.UsersRead)
  @ApiOperation({
    summary: 'Lista as solicitacoes de vinculo pendentes do usuario',
    description: 'Exige `users:read`. O codigo nunca e mostrado aqui.',
  })
  @ApiOkResponse({ type: [LinkRequestResponseDto] })
  @ApiNotFoundResponse({ description: 'Usuario nao encontrado' })
  async findPendingRequests(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LinkRequestResponseDto[]> {
    return (await this.service.listPendingRequests(id)).map(toLinkRequestResponse);
  }

  @Post('link-requests')
  @RequirePermissions(PermissionCode.UsersUpdate)
  @ApiOperation({
    summary: 'Inicia a vinculacao de uma conta externa ao usuario',
    description:
      'Exige `users:update`. NAO cria vinculo: gera um codigo de uso unico, valido por 15 ' +
      'minutos, que a propria conta do Telegram deve enviar ao bot (`/vincular <codigo>`). ' +
      'O codigo so aparece nesta resposta. No maximo uma solicitacao pendente por usuario ' +
      `e canal; o usuario precisa estar ativo. Registrado na auditoria. ${HIERARCHY_RULE}`,
  })
  @ApiCreatedResponse({ type: CreatedLinkRequestResponseDto })
  @ApiBadRequestResponse({ description: 'Canal desconhecido ou campo nao permitido' })
  @ApiNotFoundResponse({ description: 'Usuario nao encontrado' })
  @ApiConflictResponse({ description: 'Usuario inativo, ou ja ha solicitacao pendente' })
  async createRequest(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLinkRequestDto,
    @ClientIp() ip: string | null,
  ): Promise<CreatedLinkRequestResponseDto> {
    const { request, codigo } = await this.service.requestLink(actor, id, dto.canal, ip);
    return toCreatedLinkRequestResponse(request, codigo);
  }

  @Delete('link-requests/:requestId')
  @HttpCode(204)
  @RequirePermissions(PermissionCode.UsersUpdate)
  @ApiOperation({
    summary: 'Cancela uma solicitacao de vinculo pendente',
    description: `Exige \`users:update\`. O codigo deixa de valer. Registrado na auditoria. ${HIERARCHY_RULE}`,
  })
  @ApiNoContentResponse({ description: 'Solicitacao cancelada' })
  @ApiNotFoundResponse({ description: 'Usuario ou solicitacao pendente nao encontrada' })
  async cancelRequest(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.service.cancelRequest(actor, id, requestId, ip);
  }

  @Delete(':linkId')
  @HttpCode(204)
  @RequirePermissions(PermissionCode.UsersUpdate)
  @ApiOperation({
    summary: 'Remove um vinculo ativo de identidade externa do usuario',
    description:
      'Exige `users:update`. Vale na proxima mensagem do canal. Registrado na auditoria. ' +
      HIERARCHY_RULE,
  })
  @ApiNoContentResponse({ description: 'Vinculo removido' })
  @ApiNotFoundResponse({ description: 'Usuario ou vinculo nao encontrado' })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.service.unlink(actor, id, linkId, ip);
  }
}
