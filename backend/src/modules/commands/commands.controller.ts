import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CommandRouter } from './command-router.service';
import { CommandChannel } from './command.types';
import { NonProductionGuard } from './non-production.guard';
import {
  toCommandResultResponse,
  CommandResultResponseDto,
} from './dto/command-result-response.dto';
import { ExecuteCommandDto } from './dto/execute-command.dto';

/**
 * Endpoint INTERNO de teste do motor de comandos.
 *
 * Existe porque ainda nao ha nenhum canal (Telegram, WhatsApp) para exercitar o
 * motor. NAO faz parte da API publica do produto e nao deve ser consumido pelo
 * frontend: quando o primeiro adaptador real existir, o caminho de producao
 * sera ele, e este endpoint continua servindo apenas para diagnostico.
 *
 * E o unico lugar deste modulo que conhece HTTP. O motor em si (`CommandRouter`)
 * recebe um contexto neutro e nao sabe por onde a mensagem chegou.
 *
 * Em producao a rota nao responde: o `NonProductionGuard` devolve 404. O motor
 * continua disponivel normalmente para os adaptadores, que o chamam pelo
 * `CommandRouter` e nao passam por aqui.
 */
@ApiTags('Commands')
@ApiBearerAuth('access-token')
@UseGuards(NonProductionGuard)
@Controller('commands')
export class CommandsController {
  constructor(private readonly router: CommandRouter) {}

  // Nao cria recurso nenhum: 200, e nao o 201 padrao do Nest para POST.
  @Post('execute')
  @HttpCode(200)
  @ApiOperation({
    summary: '[Uso interno] Executa uma mensagem no motor de comandos',
    description:
      'Endpoint de teste/diagnostico, nao a API publica do produto. ' +
      'NAO existe em producao: com `NODE_ENV=production` a rota responde 404.\n\n' +
      'Exige JWT (guard global) e usa SEMPRE o usuario autenticado como identidade: ' +
      'o corpo nao aceita `userId` nem `channel`, entao nao ha como executar um ' +
      'comando em nome de outra pessoa nem se passar por um canal externo.\n\n' +
      'Responde 200 tambem quando o comando falha - o desfecho vai em `success` e ' +
      '`outcome`. Cada comando aplica as proprias permissoes, as mesmas do RBAC do ' +
      'restante da API.',
  })
  @ApiOkResponse({ type: CommandResultResponseDto })
  @ApiBadRequestResponse({ description: 'Corpo invalido, ou campo nao permitido enviado' })
  @ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
  @ApiNotFoundResponse({ description: 'Ambiente de producao: a rota nao esta disponivel' })
  async execute(
    @Body() body: ExecuteCommandDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CommandResultResponseDto> {
    const result = await this.router.execute({
      user,
      conversationId: body.conversationId ?? `${CommandChannel.Test}:${user.id}`,
      channel: CommandChannel.Test,
      text: body.text,
    });

    return toCommandResultResponse(result);
  }
}
