import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import type { IdentityLinkRequest } from '../entities/identity-link-request.entity';
import { IdentityChannel, LinkRequestStatus } from '../external-identity.enums';
import { LINK_COMMAND } from '../link-confirmation.service';

/**
 * Inicio de uma vinculacao. So o canal: NAO ha campo de id externo (quem
 * confirma e a propria conta, pelo codigo) nem de usuario (e o da rota). O
 * `ValidationPipe` global recusa com 400 qualquer outro campo.
 */
export class CreateLinkRequestDto {
  @ApiProperty({ enum: IdentityChannel, example: IdentityChannel.Telegram })
  @IsEnum(IdentityChannel, {
    message: `canal deve ser um destes valores: ${Object.values(IdentityChannel).join(', ')}`,
  })
  canal: IdentityChannel;
}

/** Solicitacao como a API a lista - sem codigo nem hash. */
export class LinkRequestResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: IdentityChannel })
  canal: IdentityChannel;

  @ApiProperty({ enum: LinkRequestStatus })
  status: LinkRequestStatus;

  @ApiProperty({ format: 'date-time' })
  expiraEm: Date;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/**
 * Solicitacao recem-criada. E a UNICA resposta que traz o codigo: ele nao e
 * gravado (so o hash), nao aparece em listagem, log nem auditoria.
 */
export class CreatedLinkRequestResponseDto extends LinkRequestResponseDto {
  @ApiProperty({
    example: 'K7QM-2XRA-9CVB',
    description:
      'Codigo de uso unico. Deve ser enviado ao bot PELA conta do Telegram que sera ' +
      'vinculada, em conversa privada. Nao e mostrado de novo.',
  })
  codigo: string;

  @ApiProperty({
    example: 'Envie ao bot do Telegram, em conversa privada: /vincular K7QM-2XRA-9CVB',
  })
  instrucao: string;
}

export function toLinkRequestResponse(request: IdentityLinkRequest): LinkRequestResponseDto {
  return {
    id: request.id,
    canal: request.canal,
    status: request.status,
    expiraEm: request.expiraEm,
    createdAt: request.createdAt,
  };
}

export function toCreatedLinkRequestResponse(
  request: IdentityLinkRequest,
  codigo: string,
): CreatedLinkRequestResponseDto {
  return {
    ...toLinkRequestResponse(request),
    codigo,
    instrucao: `Envie ao bot do Telegram, em conversa privada: /${LINK_COMMAND} ${codigo}`,
  };
}
