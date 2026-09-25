import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProfileResponseDto, toProfileResponse } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

/**
 * Dados pessoais do proprio usuario.
 *
 * Nao ha parametro de usuario em nenhuma rota: a identidade vem do JWT, pelo
 * mesmo `@CurrentUser()` que `/auth/me` usa. Por isso tambem nao ha permissao
 * granular - ver e editar os proprios dados nao e privilegio administrativo, e
 * o recorte "so o proprio" ja e absoluto. O `JwtAuthGuard` global continua
 * exigindo o token.
 *
 * Nao existem `POST /profile`, `DELETE /profile`, `PATCH /profile/role` nem
 * `PATCH /profile/permissions`: criar, apagar, trocar perfil e trocar status
 * sao operacoes administrativas, e vivem em `/users` com regra de hierarquia.
 */
@ApiTags('Profile')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({
    summary: 'Devolve o perfil do usuario autenticado',
    description:
      'Somente leitura. Nao gera registro de auditoria. Os dados vem do usuario que o ' +
      'JwtAuthGuard ja releu do banco nesta requisicao - nenhuma consulta adicional.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  findOwn(@CurrentUser() actor: AuthenticatedUser): ProfileResponseDto {
    return toProfileResponse(actor);
  }

  @Patch()
  @ApiOperation({
    summary: 'Atualiza os dados pessoais do proprio usuario',
    description:
      'Hoje apenas `nome`. E-mail, senha, perfil, status, permissoes e id NAO passam por ' +
      'aqui: por estarem fora do DTO, sao recusados com 400 pelo ValidationPipe global. ' +
      'Corpo que nao muda nada responde 200 sem gravar e sem auditar.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({ description: 'Campo invalido, ou campo que o perfil nao aceita' })
  @ApiNotFoundResponse({ description: 'Conta apagada entre a autenticacao e a gravacao' })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @ClientIp() ip: string | null,
  ): Promise<ProfileResponseDto> {
    return toProfileResponse(await this.profileService.update(actor, dto, ip));
  }
}
