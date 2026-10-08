import { Controller, Get } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentService } from './decorators/current-service.decorator';
import { ServiceRoute } from './decorators/service-route.decorator';
import { ServiceIdentityResponseDto } from './dto/service-identity-response.dto';
import { SERVICE_TOKEN_HEADER } from './service-auth.constants';
import { type AuthenticatedService, ServiceScope } from './service-principals';

/**
 * Rotas EXCLUSIVAS de servico (`X-Service-Token`).
 *
 * Esta so existe para provar a autenticacao servico-a-servico: devolve a
 * identidade de quem chama e nada mais. NAO le nem altera dado de negocio, NAO
 * executa comando e NAO da acesso administrativo. Nao e uma API geral de
 * comandos - essa nao existe nesta etapa.
 *
 * Nao e publica: sem credencial de servico valida, 401.
 */
@ApiTags('Service')
@ApiHeader({
  name: SERVICE_TOKEN_HEADER,
  required: true,
  description:
    'Credencial de servico (opaca, 256 bits). NAO e um JWT de pessoa: um `Authorization: Bearer` e recusado nesta rota.',
})
@ApiUnauthorizedResponse({ description: 'Credencial de servico ausente, invalida ou revogada' })
@ApiForbiddenResponse({ description: 'Servico sem o escopo exigido pela rota' })
@Controller('service')
export class ServiceController {
  @Get('identity')
  @ServiceRoute(ServiceScope.Identity)
  @ApiOperation({
    summary: 'Identifica o servico autenticado',
    description:
      'Exige o escopo `service:identity`. Devolve qual sistema esta chamando e qual credencial ' +
      'autenticou. Nao ha ator de negocio aqui: o servico NAO e uma pessoa, e nenhum ' +
      'identificador de usuario e aceito ou devolvido.',
  })
  @ApiOkResponse({ type: ServiceIdentityResponseDto })
  identity(@CurrentService() service: AuthenticatedService): ServiceIdentityResponseDto {
    return {
      authenticatedAs: 'service',
      principal: service.principal,
      credentialId: service.credentialId,
      scopes: [...service.scopes],
    };
  }
}
