import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { WhatsappIngestDto, WhatsappIngestResponseDto } from './whatsapp-ingest.dto';
import type { WhatsappMessageProcessor } from './whatsapp-message.processor';
import { WHATSAPP_PROCESSOR } from './whatsapp-processor.token';
import { resolveWhatsappTransport } from './whatsapp-settings';

/**
 * Entrada das mensagens do WhatsApp pelo GATEWAY (Baileys), SO para o servico.
 *
 * Nao e publica: sem credencial de servico com o escopo `service:whatsapp:ingest`, 401/403. O Nginx tambem
 * bloqueia `/api/service*`; o gateway chega direto pela rede interna. Um JWT de pessoa nao a abre.
 *
 * Desligada por padrao: 404 (como se nao existisse) a menos que `WHATSAPP_ENABLED=true` E
 * `WHATSAPP_TRANSPORT=gateway`. O webhook da Meta e esta rota nunca estao ativos ao mesmo tempo.
 *
 * Ter a credencial NAO permite escolher quem fala nem para quem se responde: a pessoa vem do vinculo do
 * REMETENTE (`from`) e a resposta volta para esse mesmo remetente. O gateway so transporta.
 */
@ApiTags('Service')
@ApiHeader({
  name: SERVICE_TOKEN_HEADER,
  required: true,
  description: 'Credencial de servico com o escopo `service:whatsapp:ingest`.',
})
@ApiUnauthorizedResponse({ description: 'Credencial de servico ausente, invalida ou revogada' })
@ApiForbiddenResponse({ description: 'Sem o escopo exigido' })
@Controller('service/whatsapp')
export class WhatsappIngestController {
  constructor(
    private readonly config: ConfigService,
    @Inject(WHATSAPP_PROCESSOR) private readonly processor: WhatsappMessageProcessor,
  ) {}

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @ServiceRoute(ServiceScope.WhatsappIngest)
  @ApiOperation({
    summary: 'Entrega uma mensagem de texto do WhatsApp (gateway) para avaliacao',
    description:
      'O backend reserva a mensagem (idempotencia), descarta antigas, aplica o limite por remetente, ' +
      'identifica a pessoa vinculada ao remetente, aplica o RBAC DELA e executa pelo Command Engine. ' +
      'Devolve o texto da resposta e o remetente a quem entrega-la (sempre o `from`).',
  })
  @ApiOkResponse({ type: WhatsappIngestResponseDto })
  @ApiBadRequestResponse({ description: 'Corpo fora do contrato (campo a mais, tipo errado...)' })
  async ingest(
    @Body() body: WhatsappIngestDto,
    @CurrentService() service: AuthenticatedService,
  ): Promise<WhatsappIngestResponseDto> {
    if (
      this.config.get<boolean>('WHATSAPP_ENABLED') !== true ||
      resolveWhatsappTransport(this.config.get<string>('WHATSAPP_TRANSPORT')) !== 'gateway'
    ) {
      throw new NotFoundException();
    }
    const result = await this.processor.process(
      {
        phoneNumberId: body.to,
        messageId: body.messageId,
        from: body.from,
        text: body.text,
        timestamp: body.timestamp,
      },
      {
        origem: 'gateway-baileys',
        principal: service.principal,
        servicoId: service.credentialId,
      },
    );
    return {
      correlationId: result.correlationId,
      outcome: result.outcome,
      duplicate: result.outcome === 'DUPLICATE',
      // O destino e o remetente da mensagem recebida; nunca um valor vindo de outro campo.
      replyTo: result.reply === null ? null : body.from,
      reply: result.reply,
    };
  }
}
