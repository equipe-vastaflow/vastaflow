import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsDefined,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ENVELOPE_PLATFORM, ENVELOPE_VERSION } from '../telegram/telegram-envelope';

/** Tamanho maximo do texto de uma mensagem na Bot API. */
export const INGEST_TEXT_MAX_LENGTH = 4096;

const DIGITS = /^\d{1,20}$/;

/**
 * O envelope que o TRANSPORTE assinou. Contrato estrito: o `ValidationPipe` global
 * tem `forbidNonWhitelisted`, entao qualquer campo a mais - `actorUserId`, `role`,
 * `permissions`, `isAdmin` - derruba a requisicao com 400 em vez de ser ignorado.
 * Nao existe campo onde o n8n possa afirmar QUEM e o usuario do VastaFlow: o
 * unico dado de identidade e o id do remetente NO TELEGRAM, protegido pela
 * assinatura.
 */
export class TelegramEnvelopeDto {
  @ApiProperty({ example: ENVELOPE_VERSION })
  @Equals(ENVELOPE_VERSION)
  version: typeof ENVELOPE_VERSION;

  @ApiProperty({ example: ENVELOPE_PLATFORM })
  @Equals(ENVELOPE_PLATFORM)
  platform: typeof ENVELOPE_PLATFORM;

  @ApiProperty({ description: 'Id do bot (parte numerica do token; nao e segredo)' })
  @IsString()
  @Matches(DIGITS)
  botId: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  updateId: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  messageId: number;

  @ApiProperty({ description: 'Chat privado: igual ao id do remetente' })
  @IsString()
  @Matches(DIGITS)
  chatId: string;

  @ApiProperty({ description: 'Id do remetente no Telegram' })
  @IsString()
  @Matches(DIGITS)
  userId: string;

  @ApiProperty({ example: 'private' })
  @Equals('private')
  chatType: 'private';

  @ApiProperty({ maxLength: INGEST_TEXT_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(INGEST_TEXT_MAX_LENGTH)
  text: string;

  @ApiProperty({ description: 'message.date do Telegram, em segundos Unix' })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  sentAt: number;

  @ApiProperty({ description: 'Quando o transporte assinou, em milissegundos Unix' })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  issuedAt: number;
}

export class TelegramIngestDto {
  @ApiProperty({ type: TelegramEnvelopeDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => TelegramEnvelopeDto)
  envelope: TelegramEnvelopeDto;

  @ApiProperty({ description: 'HMAC-SHA256 do envelope, em hexadecimal (64 caracteres)' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  signature: string;
}

/** Resposta ao n8n. O n8n a repassa sem alterar; o transporte confere a assinatura. */
export class TelegramIngestResponseDto {
  @ApiProperty({ description: 'Identificador de correlacao (tambem na auditoria)' })
  correlationId: string;

  @ApiProperty({
    description: 'EXECUTED | DENIED | UNLINKED | UNKNOWN_COMMAND | FAILED | DUPLICATE',
  })
  outcome: string;

  @ApiProperty({ description: 'Entrega repetida: nada foi executado e nao ha resposta' })
  duplicate: boolean;

  @ApiProperty({ nullable: true, type: String, description: 'Texto para o usuario' })
  reply: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'HMAC da resposta, amarrado ao envelope. Sem resposta, null',
  })
  signature: string | null;
}
