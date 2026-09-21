import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { HealthStatus } from '../health.types';

export class HealthCheckDetailDto {
  @ApiProperty({
    description: 'Estado do componente verificado',
    enum: ['ok', 'degraded', 'down'],
    example: 'ok',
  })
  status!: HealthStatus;

  @ApiPropertyOptional({
    description: 'Mensagem curta sobre o componente. Nunca contem dados sensiveis.',
    example: 'conexao estabelecida',
  })
  detail?: string;
}

export class HealthResponseDto {
  @ApiProperty({
    description:
      'Estado agregado do servico. Vale `down` se qualquer componente estiver indisponivel.',
    enum: ['ok', 'degraded', 'down'],
    example: 'ok',
  })
  status!: HealthStatus;

  @ApiProperty({
    description: 'Identificador do servico, definido pela variavel APP_NAME',
    example: 'vasta-flow',
  })
  service!: string;

  @ApiPropertyOptional({
    description:
      'Detalhamento por componente. Ausente enquanto nenhum indicador estiver registrado ' +
      '(banco entra na Etapa 2 e integracoes na Etapa 5).',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/HealthCheckDetailDto' },
  })
  checks?: Record<string, HealthCheckDetailDto>;
}
