import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditService } from '../audit/audit.service';
import type { Permission } from '../permissions/entities/permission.entity';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import { toUserResponse } from '../users/dto/user-response.dto';
import type { User } from '../users/entities/user.entity';
import type { PasswordService } from '../users/password.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { passwordVersion } from './password-version';

const IP = '10.0.0.5';

function makeUser(overrides: Partial<User> = {}): User {
  const role = {
    id: 'role-1',
    nome: RoleName.Usuario,
    descricao: '',
    permissions: [] as Permission[],
    createdAt: new Date(),
  } satisfies Role;

  return {
    id: 'user-1',
    nome: 'Maria Silva',
    email: 'maria@vasta.test',
    senhaHash: '$2b$04$hash-armazenado',
    ativo: true,
    role,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AuthService', () => {
  let usersService: jest.Mocked<
    Pick<UsersService, 'create' | 'findByEmail' | 'findById' | 'replacePasswordHash'>
  >;
  let passwordService: jest.Mocked<Pick<PasswordService, 'verify' | 'hash'>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: AuthService;

  beforeEach(() => {
    usersService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      replacePasswordHash: jest.fn(),
    };
    passwordService = { verify: jest.fn(), hash: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('jwt-assinado') };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const config = {
      get: jest.fn().mockReturnValue('1h'),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    service = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      jwtService as unknown as JwtService,
      auditService as unknown as AuditService,
      config,
    );
  });

  describe('register', () => {
    const dto = { nome: 'Maria Silva', email: 'maria@vasta.test', senha: 'Senha1234' };

    it('cria o usuario sempre com o perfil USUARIO e devolve o token', async () => {
      usersService.create.mockResolvedValue(makeUser());

      const result = await service.register(dto, IP);

      expect(usersService.create).toHaveBeenCalledWith({ ...dto, role: RoleName.Usuario });
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'user-1',
        pv: passwordVersion('$2b$04$hash-armazenado'),
      });
      expect(result).toMatchObject({
        accessToken: 'jwt-assinado',
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: { id: 'user-1', email: 'maria@vasta.test', role: RoleName.Usuario },
      });
    });

    it('registra REGISTER na auditoria com usuario e IP', async () => {
      usersService.create.mockResolvedValue(makeUser());

      await service.register(dto, IP);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: 'user-1',
          acao: AuditAction.Register,
          modulo: AuditModuleName.Auth,
          ip: IP,
        }),
      );
    });

    it('propaga o conflito de e-mail e nao audita nem emite token', async () => {
      usersService.create.mockRejectedValue(new ConflictException('E-mail ja cadastrado'));

      await expect(service.register(dto, IP)).rejects.toBeInstanceOf(ConflictException);

      expect(auditService.record).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('nao devolve o hash da senha', async () => {
      usersService.create.mockResolvedValue(makeUser());

      const result = await service.register(dto, IP);

      expect(JSON.stringify(result)).not.toContain('senhaHash');
      expect(JSON.stringify(result)).not.toContain('$2b$');
    });
  });

  describe('login', () => {
    const dto = { email: 'maria@vasta.test', senha: 'Senha1234' };

    it('com credenciais validas emite o token e audita LOGIN', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValue(true);

      const result = await service.login(dto, IP);

      expect(passwordService.verify).toHaveBeenCalledWith('Senha1234', '$2b$04$hash-armazenado');
      expect(result.accessToken).toBe('jwt-assinado');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: 'user-1', acao: AuditAction.Login, ip: IP }),
      );
    });

    it('usuario inexistente: 401, confere a senha mesmo assim e audita sem usuario', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      passwordService.verify.mockResolvedValue(false);

      await expect(service.login(dto, IP)).rejects.toBeInstanceOf(UnauthorizedException);

      // Hash `undefined` faz o PasswordService gastar o mesmo tempo de um usuario real.
      expect(passwordService.verify).toHaveBeenCalledWith('Senha1234', undefined);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: undefined, acao: AuditAction.LoginFailed }),
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('senha incorreta: 401 e audita LOGIN_FAILED com o usuario', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValue(false);

      await expect(service.login(dto, IP)).rejects.toThrow('Credenciais invalidas');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: 'user-1', acao: AuditAction.LoginFailed }),
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('usuario e senha incorretos geram exatamente a mesma resposta', async () => {
      passwordService.verify.mockResolvedValue(false);

      usersService.findByEmail.mockResolvedValue(null);
      const unknown = await service.login(dto, IP).catch((error: unknown) => error);
      usersService.findByEmail.mockResolvedValue(makeUser());
      const wrongPassword = await service.login(dto, IP).catch((error: unknown) => error);

      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect((unknown as UnauthorizedException).getResponse()).toEqual(
        (wrongPassword as UnauthorizedException).getResponse(),
      );
    });

    it('usuario inativo com senha correta: 403, audita e nao emite token', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser({ ativo: false }));
      passwordService.verify.mockResolvedValue(true);

      await expect(service.login(dto, IP)).rejects.toBeInstanceOf(ForbiddenException);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: 'user-1', acao: AuditAction.LoginFailed }),
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('usuario inativo com senha errada: 401, sem revelar que a conta esta inativa', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser({ ativo: false }));
      passwordService.verify.mockResolvedValue(false);

      await expect(service.login(dto, IP)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('audita LOGOUT', async () => {
      await service.logout(
        {
          id: 'user-1',
          nome: 'Maria',
          email: 'maria@vasta.test',
          role: RoleName.Usuario,
          permissions: [],
          ativo: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        IP,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: 'user-1', acao: AuditAction.Logout, ip: IP }),
      );
    });
  });

  describe('changePassword', () => {
    const actor = toUserResponse(makeUser());
    const dto = { senhaAtual: 'SenhaAtual1', novaSenha: 'NovaSenha2' };

    it('senha atual incorreta: 400, nada gravado, sem token e sem auditoria', async () => {
      usersService.findById.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValue(false);

      await expect(service.changePassword(actor, dto, IP)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(passwordService.hash).not.toHaveBeenCalled();
      expect(usersService.replacePasswordHash).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('nova senha igual a atual: 400, nada gravado', async () => {
      usersService.findById.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValue(true);

      await expect(service.changePassword(actor, dto, IP)).rejects.toThrow(
        'A nova senha deve ser diferente da senha atual',
      );

      expect(passwordService.hash).not.toHaveBeenCalled();
      expect(usersService.replacePasswordHash).not.toHaveBeenCalled();
    });

    it('conta inativa ou inexistente: 401', async () => {
      usersService.findById.mockResolvedValue(makeUser({ ativo: false }));
      await expect(service.changePassword(actor, dto, IP)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      usersService.findById.mockResolvedValue(null);
      await expect(service.changePassword(actor, dto, IP)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(usersService.replacePasswordHash).not.toHaveBeenCalled();
    });

    it('so age sobre quem esta autenticado: o id lido e gravado e o do actor', async () => {
      usersService.findById.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      passwordService.hash.mockResolvedValue('$2b$04$hash-novo');
      usersService.replacePasswordHash.mockResolvedValue(true);

      await service.changePassword(actor, dto, IP);

      expect(usersService.findById).toHaveBeenCalledWith('user-1');
      expect(usersService.replacePasswordHash).toHaveBeenCalledWith(
        'user-1',
        '$2b$04$hash-armazenado',
        '$2b$04$hash-novo',
        expect.any(Date),
      );
    });

    it('sucesso: audita PASSWORD_CHANGED sem segredo e devolve token com o pv NOVO', async () => {
      usersService.findById.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      passwordService.hash.mockResolvedValue('$2b$04$hash-novo');
      usersService.replacePasswordHash.mockResolvedValue(true);

      const result = await service.changePassword(actor, dto, IP);

      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'user-1',
        pv: passwordVersion('$2b$04$hash-novo'),
      });
      expect(passwordVersion('$2b$04$hash-novo')).not.toBe(
        passwordVersion('$2b$04$hash-armazenado'),
      );
      expect(result).toMatchObject({ accessToken: 'jwt-assinado', tokenType: 'Bearer' });
      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith({
        usuarioId: 'user-1',
        acao: AuditAction.PasswordChanged,
        modulo: AuditModuleName.Auth,
        descricao: 'Senha propria alterada',
        ip: IP,
        metadados: { alvoId: 'user-1' },
      });
      const exposto = JSON.stringify([auditService.record.mock.calls, result]);
      expect(exposto).not.toMatch(/SenhaAtual1|NovaSenha2|hash-novo|hash-armazenado/);
    });

    it('troca concorrente (hash mudou no meio): 409, sem token e sem auditoria', async () => {
      usersService.findById.mockResolvedValue(makeUser());
      passwordService.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      passwordService.hash.mockResolvedValue('$2b$04$hash-novo');
      usersService.replacePasswordHash.mockResolvedValue(false);

      await expect(service.changePassword(actor, dto, IP)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
