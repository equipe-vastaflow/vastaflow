import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Formato unico de erro da API.
 *
 * Toda falha - de validacao, de regra de negocio ou inesperada - chega ao
 * cliente neste formato, produzido pelo `AllExceptionsFilter`.
 */
export class ErrorResponseDto {
  @ApiProperty({ description: 'Codigo HTTP da resposta', example: 400 })
  statusCode!: number;

  @ApiProperty({ description: 'Descricao curta do erro', example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    description: 'Mensagem legivel. Pode conter varias entradas em erros de validacao.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Requisicao invalida',
  })
  message!: string | string[];

  @ApiProperty({ description: 'Caminho requisitado', example: '/health' })
  path!: string;

  @ApiProperty({
    description: 'Momento da falha, em ISO 8601 (UTC)',
    example: '2026-01-31T13:45:12.001Z',
  })
  timestamp!: string;

  @ApiPropertyOptional({
    description:
      'Identificador da ocorrencia. Presente em erros 5xx para correlacionar a resposta ' +
      'com a entrada correspondente no log do servidor.',
    example: 'c2f1a0e4-9d7b-4f0a-9b3a-1f5f2c6c8f11',
  })
  incidentId?: string;
}
