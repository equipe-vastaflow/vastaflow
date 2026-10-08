import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  SERVICE_ROUTE_KEY,
  SERVICE_UNAUTHORIZED_MESSAGE,
} from '../../service-auth/service-auth.constants';
import { UsersService } from '../../users/users.service';
import type { AuthenticatedRequest, JwtPayload } from '../auth.types';
import { toAuthenticatedUser } from '../authenticated-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard global de autenticacao.
 *
 * Toda rota exige um `Authorization: Bearer <jwt>` valido, exceto as marcadas
 * com `@Public()`. Alem da assinatura e da expiracao, confere no banco que o
 * usuario ainda existe e esta ativo - um token emitido antes da desativacao da
 * conta deixa de funcionar imediatamente.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Rota EXCLUSIVA de servico: quem autentica e o `ServiceAuthGuard`, que roda
    // ANTES deste. Aqui so se CONFIRMA que ele autenticou (fail-closed): se o
    // guard de servico nao estivesse registrado, a rota daria 401, e nao ficaria
    // aberta. A rota nao e `@Public()`.
    //
    // Este e o unico ponto em que este guard conhece servicos. O fluxo humano
    // abaixo nao muda: um `X-Service-Token` em rota de pessoa e ignorado, e a
    // requisicao continua exigindo `Authorization: Bearer`.
    const isServiceRoute = this.reflector.getAllAndOverride<boolean | undefined>(
      SERVICE_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isServiceRoute) {
      if (request.servicePrincipal) {
        return true;
      }
      throw new UnauthorizedException(SERVICE_UNAUTHORIZED_MESSAGE);
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Token de acesso ausente');
    }

    const userId = await this.verify(token);
    // Mesma regra dos canais de mensageria (`toAuthenticatedUser`).
    const user = toAuthenticatedUser(await this.usersService.findById(userId));
    if (!user) {
      // Mesma resposta para "nao existe" e "inativo": nao revela o estado da conta.
      throw new UnauthorizedException('Token de acesso invalido ou expirado');
    }

    request.user = user;
    return true;
  }

  private async verify(token: string): Promise<string> {
    try {
      // Fixar o algoritmo impede o ataque de troca de algoritmo (ex.: `none`).
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: ['HS256'],
      });
      if (typeof payload.sub === 'string' && payload.sub !== '') {
        return payload.sub;
      }
    } catch {
      // Assinatura invalida, token expirado ou malformado: todos viram 401.
    }
    throw new UnauthorizedException('Token de acesso invalido ou expirado');
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
