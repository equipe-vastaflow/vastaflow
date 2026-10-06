import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { UserIdentity } from '../../users/user-directory.service';
import type { Document } from '../entities/document.entity';

/** Autor do envio, resolvido pelo backend em lote. */
export class DocumentAuthorDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  nome: string;

  @ApiProperty()
  email: string;
}

/**
 * Documento como a API o devolve.
 *
 * NAO expoe `storageKey`, caminho fisico, bucket, regiao nem qualquer detalhe
 * de storage: sao infraestrutura, e quem consome a API nao precisa deles para
 * nada - a rota de download recebe o `id`, nao a chave.
 */
export class DocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Contrato de prestacao de servico.pdf' })
  nome: string;

  @ApiProperty({
    example: 'Contrato de prestacao de servico.pdf',
    description: 'Nome enviado pelo usuario, preservado como metadado',
  })
  nomeOriginal: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType: string;

  @ApiProperty({ example: 182_344, description: 'Tamanho em bytes' })
  tamanho: number;

  @ApiProperty({ format: 'uuid', description: 'Quem enviou. Metadado, nao controle de acesso.' })
  criadoPorId: string;

  @ApiPropertyOptional({
    type: DocumentAuthorDto,
    nullable: true,
    description: 'Autor identificado. Nulo quando o usuario nao existe mais.',
  })
  criadoPor: DocumentAuthorDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export function toDocumentResponse(document: Document, autor?: UserIdentity): DocumentResponseDto {
  return {
    id: document.id,
    nome: document.nome,
    nomeOriginal: document.nomeOriginal,
    mimeType: document.mimeType,
    tamanho: document.tamanho,
    criadoPorId: document.criadoPorId,
    criadoPor: autor ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
