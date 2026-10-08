import type { Request } from 'express';
import type { AuthenticatedService } from '../service-auth/service-principals';
import type { UserResponseDto } from '../users/dto/user-response.dto';

/**
 * Conteudo do JWT. Guarda apenas o identificador: perfil, permissoes e status
 * sao lidos do banco a cada requisicao, entao desativar um usuario ou trocar o
 * perfil dele vale imediatamente, sem esperar o token expirar.
 */
export interface JwtPayload {
  sub: string;
}

/** Usuario autenticado, anexado a requisicao pelo `JwtAuthGuard`. */
export type AuthenticatedUser = UserResponseDto;

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  /**
   * Servico autenticado por `X-Service-Token`. EXCLUSIVO do `ServiceAuthGuard`:
   * so ele escreve aqui, e so em rotas `@ServiceRoute`. Nunca vem do cliente.
   * Uma requisicao tem `user` (pessoa) OU `servicePrincipal` (sistema), nunca os
   * dois.
   */
  servicePrincipal?: AuthenticatedService;
}
