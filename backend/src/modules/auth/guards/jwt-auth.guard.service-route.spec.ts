import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import {
  SERVICE_ROUTE_KEY,
  SERVICE_UNAUTHORIZED_MESSAGE,
} from '../../service-auth/service-auth.constants';
import { ServicePrincipalId, ServiceScope } from '../../service-auth/service-principals';
import type { UsersService } from '../../users/users.service';
import type { AuthenticatedRequest } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * O ramo de rota de servico do `JwtAuthGuard`.
 *
 * Arquivo SEPARADO de `jwt-auth.guard.spec.ts` de proposito: aquele spec ficou
 * intocado, e continuar passando sem alteracao e a prova de que o fluxo humano
 * nao mudou.
 */
function contexto(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard: rota de servico', () => {
  let marcas: Record<string, boolean>;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    marcas = {};
    // Diferente do spec original, aqui a resposta depende da CHAVE consultada.
    reflector = {
      getAllAndOverride: jest.fn((chave: string) => marcas[chave] ?? false) as never,
    };
    jwtService = { verifyAsync: jest.fn() };
    usersService = { findById: jest.fn() };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
    );
  });

  it('rota de servico COM identidade de servico anexada: libera, sem tocar o JWT', async () => {
    marcas[SERVICE_ROUTE_KEY] = true;
    const request: Partial<AuthenticatedRequest> = {
      headers: {},
      servicePrincipal: {
        principal: ServicePrincipalId.N8n,
        credentialId: 'n8n-2026-10',
        scopes: [ServiceScope.Identity],
      },
    };

    await expect(guard.canActivate(contexto(request))).resolves.toBe(true);

    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('rota de servico SEM identidade de servico: 401 (fail-closed)', async () => {
    // Se o `ServiceAuthGuard` nao estivesse registrado, ou rodasse depois, e
    // isto que acontece: a rota nega, e nao fica aberta.
    marcas[SERVICE_ROUTE_KEY] = true;

    await expect(guard.canActivate(contexto({ headers: {} }))).rejects.toThrow(
      new UnauthorizedException(SERVICE_UNAUTHORIZED_MESSAGE),
    );
  });

  it('rota de servico: um JWT de pessoa NAO substitui a identidade de servico', async () => {
    marcas[SERVICE_ROUTE_KEY] = true;
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });

    await expect(
      guard.canActivate(contexto({ headers: { authorization: 'Bearer um.jwt.valido' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rota de servico: nem o nome do JWT chega a ser avaliado', async () => {
    marcas[SERVICE_ROUTE_KEY] = true;

    await expect(guard.canActivate(contexto({ headers: {} }))).rejects.toBeDefined();

    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('rota que NAO e de servico ignora uma identidade de servico anexada: exige JWT', async () => {
    // Uma identidade de servico solta na requisicao NAO autentica uma rota de
    // pessoa. Sem `Authorization: Bearer`, continua 401 'Token de acesso ausente'.
    const request: Partial<AuthenticatedRequest> = {
      headers: {},
      servicePrincipal: {
        principal: ServicePrincipalId.N8n,
        credentialId: 'n8n-2026-10',
        scopes: [ServiceScope.Identity],
      },
    };

    await expect(guard.canActivate(contexto(request))).rejects.toThrow('Token de acesso ausente');
  });

  it('rota que NAO e de servico: um X-Service-Token e ignorado e o JWT continua obrigatorio', async () => {
    const request: Partial<AuthenticatedRequest> = {
      headers: { 'x-service-token': 'vfs_qualquercoisa' },
    };

    await expect(guard.canActivate(contexto(request))).rejects.toThrow('Token de acesso ausente');
  });

  it('@Public continua liberando, e vem antes do ramo de servico', async () => {
    marcas[IS_PUBLIC_KEY] = true;

    await expect(guard.canActivate(contexto({ headers: {} }))).resolves.toBe(true);
  });
});
