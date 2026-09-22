import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const MAX_COMMAND_TEXT_LENGTH = 1000;
export const MAX_CONVERSATION_ID_LENGTH = 100;

/**
 * Entrada do endpoint interno de teste.
 *
 * NAO existe campo `userId` nem `channel` de proposito: a identidade vem do
 * JWT e o canal e fixado como `test` pelo controller. Aceitar qualquer um dos
 * dois pelo corpo permitiria executar comandos como outra pessoa ou fingir ser
 * um canal externo. Como o `ValidationPipe` global usa `forbidNonWhitelisted`,
 * enviar esses campos resulta em 400.
 */
export class ExecuteCommandDto {
  @ApiProperty({
    description: 'Mensagem crua, como o canal a receberia.',
    example: '/ajuda',
    maxLength: MAX_COMMAND_TEXT_LENGTH,
  })
  @IsString()
  @IsNotEmpty({ message: 'text nao pode ser vazio' })
  @MaxLength(MAX_COMMAND_TEXT_LENGTH)
  text: string;

  @ApiPropertyOptional({
    description:
      'Conversa de origem. Serve so para simular threads distintas; quando ausente, ' +
      'o proprio usuario autenticado identifica a conversa.',
    example: 'teste-1',
    maxLength: MAX_CONVERSATION_ID_LENGTH,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'conversationId nao pode ser vazio' })
  @MaxLength(MAX_CONVERSATION_ID_LENGTH)
  conversationId?: string;
}
