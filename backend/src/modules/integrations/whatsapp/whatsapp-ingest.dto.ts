import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { WHATSAPP_TEXT_MAX } from './whatsapp-payload';

/** Versao do contrato gateway -> backend. Muda so junto com o gateway. */
export const WHATSAPP_INGEST_VERSION = 1;

/** Mesmo formato aceito no webhook da Meta: identificador opaco, sem espaco nem caracteres de controle. */
const MESSAGE_ID = /^[\w.=+/-]{1,200}$/;
const DIGITS = /^\d{5,20}$/;

/**
 * UMA mensagem de texto recebida pelo gateway, ja reduzida ao necessario. Contrato estrito: o `ValidationPipe`
 * global tem `forbidNonWhitelisted`, entao qualquer campo a mais (`replyTo`, `actorUserId`, `role`,
 * `permissions`...) derruba a requisicao com 400 em vez de ser ignorado. NAO existe campo onde o gateway possa
 * afirmar QUEM e o usuario do VastaFlow nem PARA QUEM a resposta vai: a identidade e o `from` (o remetente
 * da mensagem) e a resposta volta sempre para ele.
 */
export class WhatsappIngestDto {
  @ApiProperty({ example: WHATSAPP_INGEST_VERSION })
  @Equals(WHATSAPP_INGEST_VERSION)
  version: typeof WHATSAPP_INGEST_VERSION;

  @ApiProperty({
    description: 'Identificador unico da mensagem no WhatsApp (chave de idempotencia)',
  })
  @IsString()
  @Matches(MESSAGE_ID)
  messageId: string;

  @ApiProperty({
    description: 'Remetente (so digitos): a identidade externa e o destino da resposta',
  })
  @IsString()
  @Matches(DIGITS)
  from: string;

  @ApiProperty({ description: 'Destinatario (so digitos): deve ser a conta do bot configurada' })
  @IsString()
  @Matches(DIGITS)
  to: string;

  @ApiProperty({
    example: 'private',
    description: 'So conversa individual; grupo nunca chega aqui',
  })
  @Equals('private')
  chatType: 'private';

  @ApiProperty({ maxLength: WHATSAPP_TEXT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(WHATSAPP_TEXT_MAX)
  text: string;

  @ApiProperty({ description: 'Instante da mensagem, em segundos Unix' })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  timestamp: number;
}

export class WhatsappIngestResponseDto {
  @ApiProperty({ nullable: true, type: String, description: 'Id do evento (tambem na auditoria)' })
  correlationId: string | null;

  @ApiProperty({
    description:
      'IGNORED | STALE | DUPLICATE | RATE_LIMITED | LINK_CONFIRMED | LINK_REJECTED | UNLINKED | EXECUTED | DENIED | UNKNOWN_COMMAND | FAILED',
  })
  outcome: string;

  @ApiProperty({ description: 'Entrega repetida: nada foi executado e nao ha resposta' })
  duplicate: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Para quem responder: SEMPRE o `from` da mensagem recebida (nunca um valor informado pelo gateway). Sem resposta, null',
  })
  replyTo: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Texto para o usuario; null = nao responder',
  })
  reply: string | null;
}
