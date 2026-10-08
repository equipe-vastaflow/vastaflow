import { applyDecorators, SetMetadata } from '@nestjs/common';
import { SERVICE_ROUTE_KEY, SERVICE_SCOPES_KEY } from '../service-auth.constants';
import type { ServiceScope } from '../service-principals';

/**
 * Marca a rota como EXCLUSIVA de servico.
 *
 * - A rota passa a ser autenticada por `X-Service-Token` e SO por ele: um JWT de
 *   pessoa e recusado aqui, e um token de servico e recusado em toda rota que
 *   nao tenha este decorator.
 * - A rota NAO e `@Public()`. Se o `ServiceAuthGuard` nao existisse, o
 *   `JwtAuthGuard` global negaria a requisicao (fail-closed).
 * - Exige pelo menos UM escopo, e isso e imposto pelo tipo: uma rota de servico
 *   sem escopo declarado nao compila. O guard tambem nega em tempo de execucao.
 *
 * @example
 * ```ts
 * @Get('identity')
 * @ServiceRoute(ServiceScope.Identity)
 * identity(@CurrentService() service: AuthenticatedService) { ... }
 * ```
 */
export const ServiceRoute = (
  ...scopes: [ServiceScope, ...ServiceScope[]]
): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(SERVICE_ROUTE_KEY, true), SetMetadata(SERVICE_SCOPES_KEY, scopes));
