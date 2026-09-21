import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { RoleName } from '../../roles/role-name.enum';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth.types';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';

function makeContext(user?: Partial<AuthenticatedUser>): ExecutionContext {
  const request = { user } as AuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeReflector(required: unknown): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('nao restringe rotas sem @Roles', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext({ role: RoleName.Usuario }))).toBe(true);
  });

  it('libera quando o perfil do usuario esta na lista', () => {
    const guard = new RolesGuard(makeReflector([RoleName.Gestor, RoleName.Operador]));
    expect(guard.canActivate(makeContext({ role: RoleName.Operador }))).toBe(true);
  });

  it('nega quando o perfil nao esta na lista', () => {
    const guard = new RolesGuard(makeReflector([RoleName.Gestor]));
    expect(() => guard.canActivate(makeContext({ role: RoleName.Usuario }))).toThrow(
      ForbiddenException,
    );
  });

  it('ADMIN acessa tudo, mesmo fora da lista', () => {
    const guard = new RolesGuard(makeReflector([RoleName.Gestor]));
    expect(guard.canActivate(makeContext({ role: RoleName.Admin }))).toBe(true);
  });

  it('nega quando nao ha usuario autenticado (@Roles em rota publica)', () => {
    const guard = new RolesGuard(makeReflector([RoleName.Gestor]));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});

describe('PermissionsGuard', () => {
  it('nao restringe rotas sem @RequirePermissions', () => {
    const guard = new PermissionsGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext({ role: RoleName.Usuario, permissions: [] }))).toBe(true);
  });

  it('libera quando o usuario tem a permissao', () => {
    const guard = new PermissionsGuard(makeReflector([PermissionCode.UsersRead]));
    const user = { role: RoleName.Gestor, permissions: ['users:read', 'audit:read'] };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });

  it('nega quando falta a permissao', () => {
    const guard = new PermissionsGuard(makeReflector([PermissionCode.UsersRead]));
    const user = { role: RoleName.Usuario, permissions: [] };
    expect(() => guard.canActivate(makeContext(user))).toThrow(ForbiddenException);
  });

  it('exige TODAS as permissoes listadas, nao apenas uma', () => {
    const guard = new PermissionsGuard(
      makeReflector([PermissionCode.UsersRead, PermissionCode.AuditRead]),
    );
    const user = { role: RoleName.Gestor, permissions: ['users:read'] };
    expect(() => guard.canActivate(makeContext(user))).toThrow(ForbiddenException);
  });

  it('ADMIN acessa tudo, mesmo sem a permissao vinculada', () => {
    const guard = new PermissionsGuard(makeReflector([PermissionCode.AuditRead]));
    const user = { role: RoleName.Admin, permissions: [] };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });

  it('nega quando nao ha usuario autenticado', () => {
    const guard = new PermissionsGuard(makeReflector([PermissionCode.UsersRead]));
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
