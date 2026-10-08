import { ApiProperty } from '@nestjs/swagger';
import { ServicePrincipalId, ServiceScope } from '../service-principals';

export class ServiceIdentityResponseDto {
  @ApiProperty({
    description:
      'Sempre `service`. Distingue esta resposta da de uma pessoa: o chamador e um SISTEMA, nao um usuario.',
    example: 'service',
  })
  authenticatedAs!: 'service';

  @ApiProperty({ enum: ServicePrincipalId, example: ServicePrincipalId.N8n })
  principal!: ServicePrincipalId;

  @ApiProperty({
    description:
      'Qual credencial autenticou a chamada. Numa rotacao, mostra qual das duas esta em uso. Nao e segredo.',
    example: 'n8n-2026-10',
  })
  credentialId!: string;

  @ApiProperty({ enum: ServiceScope, isArray: true, example: [ServiceScope.Identity] })
  scopes!: ServiceScope[];
}
