import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
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
import { EmptyBodyDto } from './dto/empty-body.dto';
import { DEFAULT_PAGE_SIZE, ListNotificationsQuery } from './dto/list-notifications.query';
import {
  toNotificationPage,
  NotificationPageResponseDto,
} from './dto/notification-page-response.dto';
import { toNotificationResponse, NotificationResponseDto } from './dto/notification-response.dto';
import { ReadAllResponseDto } from './dto/read-all-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { NotificationsService } from './notifications.service';

/**
 * Notificacoes internas do usuario autenticado.
 *
 * Nenhuma rota e publica (o `JwtAuthGuard` global nega por padrao) e nenhuma
 * exige permissao granular: ver as proprias notificacoes nao e privilegio
 * administrativo, e o recorte por dono ja limita o que cada um alcanca -
 * mesmo criterio de `GET /auth/me` e `GET /dashboard/summary`.
 *
 * O destinatario vem SEMPRE de `@CurrentUser()`. Nao ha `usuarioId` em corpo,
 * query ou rota, e os PATCH declaram corpo vazio (`EmptyBodyDto`) - o
 * `ValidationPipe` global recusa com 400 qualquer campo enviado, inclusive uma
 * tentativa de informar o destinatario.
 *
 * Nao existe `POST /notifications` nem `DELETE /notifications`: quem cria uma
 * notificacao e outro modulo do sistema, pelo `NotificationsService.createForUser`.
 */
@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista as notificacoes do usuario autenticado, paginado',
    description:
      'Somente as do proprio usuario. Nao lidas primeiro; depois da mais recente para a mais ' +
      'antiga, com o id desempatando.',
  })
  @ApiOkResponse({ type: NotificationPageResponseDto })
  @ApiBadRequestResponse({ description: 'Parametros de paginacao invalidos' })
  async findPage(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListNotificationsQuery,
  ): Promise<NotificationPageResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const { items, total } = await this.notificationsService.list(actor.id, page, limit);

    return toNotificationPage(items, total, page, limit);
  }

  /**
   * Declarada ANTES de `:id`: o Nest casa as rotas na ordem de declaracao, e
   * `:id` engoliria `unread-count`. Ha teste e2e fixando este comportamento.
   */
  @Get('unread-count')
  @ApiOperation({
    summary: 'Quantas notificacoes o usuario tem por ler',
    description: 'Uma consulta `COUNT` no banco. Usado pelo contador do menu.',
  })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  async unreadCount(@CurrentUser() actor: AuthenticatedUser): Promise<UnreadCountResponseDto> {
    return { count: await this.notificationsService.countUnread(actor.id) };
  }

  @Patch('read-all')
  @ApiOperation({
    summary: 'Marca como lidas todas as notificacoes do usuario',
    description:
      'Idempotente: sem nenhuma por ler, nada e gravado e `atualizadas` vem zero. Alcanca ' +
      'apenas as notificacoes do proprio usuario.',
  })
  @ApiOkResponse({ type: ReadAllResponseDto })
  @ApiBadRequestResponse({ description: 'Corpo com qualquer campo: esta rota nao recebe dados' })
  async readAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _corpo: EmptyBodyDto,
  ): Promise<ReadAllResponseDto> {
    return this.notificationsService.markAllAsRead(actor.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulta uma notificacao do usuario',
    description:
      'Id de outra pessoa responde 404, e nao 403: um 403 confirmaria que aquele id existe.',
  })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiBadRequestResponse({ description: 'Id nao e um UUID' })
  @ApiNotFoundResponse({ description: 'Notificacao nao encontrada' })
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponseDto> {
    return toNotificationResponse(await this.notificationsService.get(actor.id, id));
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Marca uma notificacao como lida',
    description:
      'Idempotente: ja lida responde 200 sem gravar de novo. Id de outra pessoa responde 404.',
  })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiBadRequestResponse({ description: 'Id nao e um UUID, ou corpo com algum campo' })
  @ApiNotFoundResponse({ description: 'Notificacao nao encontrada' })
  async markAsRead(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _corpo: EmptyBodyDto,
  ): Promise<NotificationResponseDto> {
    return toNotificationResponse(await this.notificationsService.markAsRead(actor.id, id));
  }
}
