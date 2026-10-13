import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentService } from '../../service-auth/decorators/current-service.decorator';
import { ServiceRoute } from '../../service-auth/decorators/service-route.decorator';
import { SERVICE_TOKEN_HEADER } from '../../service-auth/service-auth.constants';
import { type AuthenticatedService, ServiceScope } from '../../service-auth/service-principals';
import { TelegramIngestDto, TelegramIngestResponseDto } from './telegram-ingest.dto';
import { TelegramIngestService } from './telegram-ingest.service';

/**
 * Entrada das mensagens do Telegram, SO para o servico (n8n).
 *
 * Nao e publica: sem credencial de servico com o escopo `service:telegram:ingest`,
 * 401/403. O Nginx tambem bloqueia `/api/service*`; o n8n chega direto pela rede
 * interna. E uma ROTA DE SERVICO - um JWT de pessoa nao a abre.
 *
 * Ter a credencial nao basta para executar nada: o corpo precisa trazer um envelope
 * ASSINADO pelo transporte. Ver `TelegramIngestService`.
 */
@ApiTags('Service')
@ApiHeader({
  name: SERVICE_TOKEN_HEADER,
  required: true,
  description: 'Credencial de servico com o escopo `service:telegram:ingest`.',
})
@ApiUnauthorizedResponse({ description: 'Credencial de servico ausente, invalida ou revogada' })
@ApiForbiddenResponse({ description: 'Sem o escopo, ou envelope com assinatura invalida/expirado' })
@Controller('service/telegram')
export class TelegramIngestController {
  constructor(private readonly ingest: TelegramIngestService) {}

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @ServiceRoute(ServiceScope.TelegramIngest)
  @ApiOperation({
    summary: 'Entrega uma mensagem do Telegram (envelope assinado) para avaliacao',
    description:
      'O backend verifica a assinatura, reserva o update (idempotencia), identifica a pessoa ' +
      'vinculada ao remetente, aplica o RBAC DELA e executa pelo Command Engine. Devolve a resposta ' +
      'assinada. O servico nunca e o ator e nao ha campo para afirmar quem e o usuario.',
  })
  @ApiOkResponse({ type: TelegramIngestResponseDto })
  @ApiBadRequestResponse({
    description: 'Envelope fora do contrato (campo a mais, tipo errado...)',
  })
  handle(
    @Body() body: TelegramIngestDto,
    @CurrentService() service: AuthenticatedService,
  ): Promise<TelegramIngestResponseDto> {
    return this.ingest.ingest(body, service);
  }
}
