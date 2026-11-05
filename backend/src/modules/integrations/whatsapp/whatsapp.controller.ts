import {
  Controller,
  ForbiddenException,
  Inject,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import type { WhatsappSender } from './whatsapp-api.client';
import type { WhatsappMessageProcessor } from './whatsapp-message.processor';
import { sendMetaReply } from './whatsapp-meta-reply';
import { parseWhatsappPayload } from './whatsapp-payload';
import { WHATSAPP_PROCESSOR } from './whatsapp-processor.token';
import { resolveWhatsappTransport } from './whatsapp-settings';
import { verifyChallenge, verifyMetaSignature } from './whatsapp-signature';

export const WHATSAPP_SENDER = Symbol('WHATSAPP_SENDER');

export { WHATSAPP_PROCESSOR };

/**
 * Webhook da Cloud API da Meta. PUBLICO por necessidade (a Meta chama sem JWT), mas fechado por:
 * 1. `WHATSAPP_ENABLED=false` (padrao), ou `WHATSAPP_TRANSPORT=gateway`: 404 nas duas rotas, como se nao
 *    existissem (com o gateway ativo, a Meta nao entrega nada);
 * 2. `GET`: so responde o `hub.challenge` com o `hub.verify_token` correto;
 * 3. `POST`: a assinatura `X-Hub-Signature-256` e conferida sobre o CORPO BRUTO, com o App Secret,
 *    ANTES de ler o conteudo. Invalida = 403 e nada e processado.
 *
 * Responde 200 apos processar (a Meta reentrega se nao receber 200; a idempotencia por `wamid`
 * impede a execucao dupla). A resposta nunca traz dado da mensagem. Fora do Swagger.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/whatsapp')
export class WhatsappController {
  constructor(
    private readonly config: ConfigService,
    @Inject(WHATSAPP_PROCESSOR) private readonly processor: WhatsappMessageProcessor,
    @Inject(WHATSAPP_SENDER) private readonly sender: WhatsappSender,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  verify(@Req() req: Request): string {
    this.requireEnabled();
    const challenge = verifyChallenge(
      req.query,
      this.config.get<string>('WHATSAPP_WEBHOOK_TOKEN') ?? '',
    );
    if (challenge === null) {
      throw new ForbiddenException('Verificacao recusada');
    }
    return challenge;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: true }> {
    this.requireEnabled();
    const signature = req.headers['x-hub-signature-256'];
    if (
      !verifyMetaSignature(
        req.rawBody,
        typeof signature === 'string' ? signature : undefined,
        this.config.get<string>('WHATSAPP_APP_SECRET') ?? '',
      )
    ) {
      throw new ForbiddenException('Assinatura invalida');
    }
    for (const message of parseWhatsappPayload(body).messages) {
      const result = await this.processor.process(message);
      // A resposta vai ao remetente da PROPRIA mensagem, nunca a outro numero.
      await sendMetaReply(this.sender, message.from, result.reply);
    }
    return { received: true };
  }

  private requireEnabled(): void {
    if (
      this.config.get<boolean>('WHATSAPP_ENABLED') !== true ||
      resolveWhatsappTransport(this.config.get<string>('WHATSAPP_TRANSPORT')) !== 'meta'
    ) {
      throw new NotFoundException();
    }
  }
}
