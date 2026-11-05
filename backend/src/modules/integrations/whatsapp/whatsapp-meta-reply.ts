import { Logger } from '@nestjs/common';
import { WhatsappApiError, type WhatsappSender } from './whatsapp-api.client';

const logger = new Logger('WhatsappMetaReply');

/**
 * Entrega da resposta pelo transporte ANTIGO (Cloud API da Meta). Fica fora do processador de proposito: o
 * processador so decide O QUE responder; quem leva a resposta e o transporte. Transporte novo (gateway) nao passa
 * por aqui.
 *
 * Nunca lanca: falha de envio e at-most-once, como sempre foi. O destinatario e sempre o remetente da mensagem
 * recebida (quem chama passa `message.from`); nao ha outra origem para ele.
 */
export async function sendMetaReply(
  sender: WhatsappSender,
  to: string,
  reply: string | null,
): Promise<void> {
  if (reply === null) {
    return;
  }
  try {
    await sender.sendText(to, reply);
  } catch (error) {
    logger.warn(`WhatsApp: resposta nao enviada (${describeSendFailure(error)})`);
  }
}

/**
 * Motivo do envio que falhou, so com valores numericos e a categoria fixa: `http, status 400,
 * codigo 10, subcodigo 33, tipo OAuthException`. Nunca mensagem da Meta, URL, token, destinatario ou texto.
 */
function describeSendFailure(error: unknown): string {
  if (!(error instanceof WhatsappApiError)) {
    return 'desconhecido';
  }
  const parts: string[] = [error.kind];
  if (error.httpStatus !== undefined) {
    parts.push(`status ${String(error.httpStatus)}`);
  }
  if (error.graphCode !== undefined) {
    parts.push(`codigo ${String(error.graphCode)}`);
  }
  if (error.graphSubcode !== undefined) {
    parts.push(`subcodigo ${String(error.graphSubcode)}`);
  }
  if (error.graphType !== undefined) {
    parts.push(`tipo ${error.graphType}`);
  }
  return parts.join(', ');
}
