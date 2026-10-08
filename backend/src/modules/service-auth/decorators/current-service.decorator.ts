import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SERVICE_UNAUTHORIZED_MESSAGE } from '../service-auth.constants';
import type { AuthenticatedService } from '../service-principals';

/** Requisicao depois de autenticada como servico pelo `ServiceAuthGuard`. */
export interface ServiceAuthenticatedRequest extends Request {
  servicePrincipal?: AuthenticatedService;
}

/**
 * Injeta o servico autenticado. So use em rota `@ServiceRoute`.
 *
 * Se por algum erro de configuracao a rota chegar aqui sem servico autenticado,
 * NEGA em vez de devolver `undefined`: o controller nunca precisa tratar o caso
 * "sem servico" como possivel.
 */
export const CurrentService = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedService => {
    const service = context
      .switchToHttp()
      .getRequest<ServiceAuthenticatedRequest>().servicePrincipal;
    if (!service) {
      throw new UnauthorizedException(SERVICE_UNAUTHORIZED_MESSAGE);
    }
    return service;
  },
);
