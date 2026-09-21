import type { Request } from 'express';
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
}
