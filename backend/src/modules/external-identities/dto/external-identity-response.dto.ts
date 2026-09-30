import { ApiProperty } from '@nestjs/swagger';
import type { ExternalIdentityLink } from '../entities/external-identity-link.entity';
import { IdentityChannel } from '../external-identity.enums';

/**
 * Vinculo como a API o devolve. Nao ha perfil nem permissao: o vinculo so aponta
 * para o usuario, e a autorizacao continua sendo a do usuario.
 */
export class ExternalIdentityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: IdentityChannel })
  canal: IdentityChannel;

  @ApiProperty({ example: '123456789' })
  idExterno: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

export function toExternalIdentityResponse(
  link: ExternalIdentityLink,
): ExternalIdentityResponseDto {
  return { id: link.id, canal: link.canal, idExterno: link.idExterno, createdAt: link.createdAt };
}
