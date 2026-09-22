import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { Permission } from '../../permissions/entities/permission.entity';
import { RoleName } from '../../roles/role-name.enum';
import type { User } from '../../users/entities/user.entity';
import type { UsersService } from '../../users/users.service';
import type { AuthenticatedRequest } from '../auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const activeUser = {
  id: 'user-1',
  nome: 'Maria',
  email: 'maria@vasta.test',
  senhaHash: 'hash',
  ativo: true,
  role: {
    id: 'r',
    nome: RoleName.Gestor,
    descricao: '',
    permissions: [{ code: 'users:read' } as Permission],
  },
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

describe('JwtAuthGuard', () => {
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let guard: JwtAuthGuard;

  const requestWith = (authorization?: string): Partial<AuthenticatedRequest> => ({
    headers: authorization ? { authorization } : {},
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    jwtService = { verifyAsync: jest.fn() };
    usersService = { findById: jest.fn() };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
    );
  });

  it('libera rotas @Public sem olhar o token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(makeContext(requestWith()))).resolves.toBe(true);

    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejeita requisicao sem token', async () => {
    await expect(guard.canActivate(makeContext(requestWith()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejeita esquema diferente de Bearer', async () => {
    await expect(guard.canActivate(makeContext(requestWith('Basic abc')))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejeita JWT invalido (assinatura, formato ou expiracao)', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(
      guard.canActivate(makeContext(requestWith('Bearer token-invalido'))),
    ).rejects.toThrow('Token de acesso invalido ou expirado');
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('exige HS256 na verificacao', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    usersService.findById.mockResolvedValue(activeUser);

    await guard.canActivate(makeContext(requestWith('Bearer abc')));

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('abc', { algorithms: ['HS256'] });
  });

  it.each([[{}], [{ sub: 123 }], [{ sub: '' }]])(
    'rejeita JWT valido sem `sub` utilizavel (%j)',
    async (payload) => {
      jwtService.verifyAsync.mockResolvedValue(payload);

      await expect(
        guard.canActivate(makeContext(requestWith('Bearer abc'))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('rejeita usuario que nao existe mais', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    usersService.findById.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext(requestWith('Bearer abc')))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejeita usuario inativo, mesmo com token valido', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    usersService.findById.mockResolvedValue({ ...activeUser, ativo: false });

    await expect(guard.canActivate(makeContext(requestWith('Bearer abc')))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('aceita token valido e anexa o usuario (perfil e permissoes) a requisicao', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    usersService.findById.mockResolvedValue(activeUser);
    const request = requestWith('bearer abc');

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(request.user).toEqual({
      id: 'user-1',
      nome: 'Maria',
      email: 'maria@vasta.test',
      role: RoleName.Gestor,
      permissions: ['users:read'],
      ativo: true,
      createdAt: activeUser.createdAt,
      updatedAt: activeUser.updatedAt,
    });
  });
});
