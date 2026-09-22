import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { Permission } from '../permissions/entities/permission.entity';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import type { RolesService } from '../roles/roles.service';
import type { User } from './entities/user.entity';
import { UserManagementService } from './user-management.service';
import {
  DuplicateEmailError,
  type LockedAdminChange,
  type UsersRepository,
} from './users.repository';
import type { UsersService } from './users.service';

const GESTOR_CODES = ['users:read', 'users:create', 'users:update', 'users:status', 'users:role'];

function makeRole(nome: RoleName, codes: string[] = []): Role {
  return {
    id: `role-${nome}`,
    nome,
    descricao: '',
    permissions: codes.map((code) => ({ id: code, code }) as Permission),
    createdAt: new Date(),
  };
}

const ROLES: Record<RoleName, Role> = {
  [RoleName.Admin]: makeRole(RoleName.Admin, [...GESTOR_CODES, 'audit:read']),
  [RoleName.Gestor]: makeRole(RoleName.Gestor, GESTOR_CODES),
  [RoleName.Operador]: makeRole(RoleName.Operador),
  [RoleName.Usuario]: makeRole(RoleName.Usuario),
};

function makeUser(id: string, role: RoleName, overrides: Partial<User> = {}): User {
  return {
    id,
    nome: `Nome ${id}`,
    email: `${id}@vasta.test`,
    senhaHash: '$2b$04$hash',
    ativo: true,
    role: ROLES[role],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function actorFrom(user: User): AuthenticatedUser {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role.nome,
    permissions: user.role.permissions.map((permission) => permission.code),
    ativo: user.ativo,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

const IP = '10.0.0.1';
const admin = actorFrom(makeUser('admin', RoleName.Admin));
const gestor = actorFrom(makeUser('gestor', RoleName.Gestor));

describe('UserManagementService', () => {
  let repository: jest.Mocked<
    Pick<
      UsersRepository,
      'findById' | 'findByEmail' | 'findPage' | 'update' | 'runLockedAdminChange'
    >
  >;
  let usersService: jest.Mocked<Pick<UsersService, 'create'>>;
  let rolesService: jest.Mocked<Pick<RolesService, 'getByName' | 'findAll'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: UserManagementService;

  /** Estado que o repositorio "le sob lock" na proxima alteracao de status/perfil. */
  let locked: { target: User | null; activeAdminCount: number };
  let save: jest.Mock<Promise<User>, [User]>;

  beforeEach(() => {
    locked = { target: null, activeAdminCount: 2 };
    save = jest.fn((user: User) => Promise.resolve(user));
    repository = {
      findById: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      findPage: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn((user: User) => Promise.resolve(user)),
      runLockedAdminChange: jest.fn(
        (_id: string, work: (change: LockedAdminChange) => Promise<unknown>) =>
          work({ ...locked, save }),
      ) as unknown as jest.Mocked<UsersRepository>['runLockedAdminChange'],
    };
    usersService = {
      create: jest.fn((input) =>
        Promise.resolve(makeUser('novo', input.role, { nome: input.nome, email: input.email })),
      ),
    };
    rolesService = {
      getByName: jest.fn((nome: RoleName) => Promise.resolve(ROLES[nome])),
      findAll: jest.fn().mockResolvedValue(Object.values(ROLES)),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    service = new UserManagementService(
      usersService as unknown as UsersService,
      repository as unknown as UsersRepository,
      rolesService as unknown as RolesService,
      auditService as unknown as AuditService,
    );
  });

  describe('list e get', () => {
    it('converte pagina em skip/take', async () => {
      await service.list(3, 20);
      expect(repository.findPage).toHaveBeenCalledWith(40, 20);
    });

    it('get lanca 404 para usuario inexistente', async () => {
      await expect(service.get('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assignableRoles', () => {
    it('ADMIN concede todos os perfis, na ordem do catalogo', async () => {
      await expect(service.assignableRoles(admin)).resolves.toEqual(Object.values(RoleName));
    });

    it('GESTOR concede apenas perfis abaixo do seu', async () => {
      await expect(service.assignableRoles(gestor)).resolves.toEqual([
        RoleName.Operador,
        RoleName.Usuario,
      ]);
    });
  });

  describe('create', () => {
    const dto = { nome: 'Joana', email: 'joana@vasta.test', senha: 'Senha1234' };

    it('cria com USUARIO por padrao e audita sem a senha', async () => {
      await service.create(gestor, dto, IP);

      expect(usersService.create).toHaveBeenCalledWith({ ...dto, role: RoleName.Usuario });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          usuarioId: gestor.id,
          acao: AuditAction.UserCreated,
          modulo: AuditModuleName.Users,
          ip: IP,
          metadados: { alvoId: 'novo', email: 'joana@vasta.test', role: RoleName.Usuario },
        }),
      );
      expect(JSON.stringify(auditService.record.mock.calls)).not.toContain('Senha1234');
    });

    it.each([RoleName.Gestor, RoleName.Admin])(
      'GESTOR nao cria usuario com perfil %s (403) e nada e gravado',
      async (role) => {
        await expect(service.create(gestor, { ...dto, role }, IP)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(usersService.create).not.toHaveBeenCalled();
        expect(auditService.record).not.toHaveBeenCalled();
      },
    );

    it('ADMIN cria outro ADMIN', async () => {
      await service.create(admin, { ...dto, role: RoleName.Admin }, IP);
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: RoleName.Admin }),
      );
    });
  });

  describe('update', () => {
    it('altera nome e e-mail (normalizado) e audita o antes/depois', async () => {
      repository.findById.mockResolvedValue(makeUser('alvo', RoleName.Usuario));

      const saved = await service.update(
        gestor,
        'alvo',
        { nome: 'Novo Nome', email: ' Novo@Vasta.TEST ' },
        IP,
      );

      expect(saved).toMatchObject({ nome: 'Novo Nome', email: 'novo@vasta.test' });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: AuditAction.UserUpdated,
          metadados: {
            alvoId: 'alvo',
            alteracoes: {
              nome: { de: 'Nome alvo', para: 'Novo Nome' },
              email: { de: 'alvo@vasta.test', para: 'novo@vasta.test' },
            },
          },
        }),
      );
    });

    it('sem mudancas reais nao grava nem audita', async () => {
      const target = makeUser('alvo', RoleName.Usuario);
      repository.findById.mockResolvedValue(target);

      await service.update(gestor, 'alvo', { nome: target.nome, email: target.email }, IP);

      expect(repository.update).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('e-mail de outro usuario: 409', async () => {
      repository.findById.mockResolvedValue(makeUser('alvo', RoleName.Usuario));
      repository.findByEmail.mockResolvedValue(makeUser('outro', RoleName.Usuario));

      await expect(
        service.update(gestor, 'alvo', { email: 'outro@vasta.test' }, IP),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('violacao de unicidade no banco (corrida) vira 409', async () => {
      repository.findById.mockResolvedValue(makeUser('alvo', RoleName.Usuario));
      repository.update.mockRejectedValue(new DuplicateEmailError());

      await expect(
        service.update(gestor, 'alvo', { email: 'livre@vasta.test' }, IP),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('GESTOR nao edita outro GESTOR nem ADMIN (403)', async () => {
      for (const role of [RoleName.Gestor, RoleName.Admin]) {
        repository.findById.mockResolvedValue(makeUser('alvo', role));
        await expect(service.update(gestor, 'alvo', { nome: 'X' }, IP)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
    });

    it('qualquer um edita os proprios dados', async () => {
      repository.findById.mockResolvedValue(makeUser(gestor.id, RoleName.Gestor));

      await expect(service.update(gestor, gestor.id, { nome: 'Eu' }, IP)).resolves.toMatchObject({
        nome: 'Eu',
      });
    });

    it('usuario inexistente: 404', async () => {
      await expect(service.update(admin, 'x', { nome: 'X' }, IP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setStatus', () => {
    it('desativa, grava e audita USER_DEACTIVATED', async () => {
      locked.target = makeUser('alvo', RoleName.Usuario);

      const saved = await service.setStatus(gestor, 'alvo', false, IP);

      expect(saved.ativo).toBe(false);
      expect(save).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: AuditAction.UserDeactivated,
          metadados: { alvoId: 'alvo' },
        }),
      );
    });

    it('ativa e audita USER_ACTIVATED', async () => {
      locked.target = makeUser('alvo', RoleName.Usuario, { ativo: false });

      await service.setStatus(gestor, 'alvo', true, IP);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ acao: AuditAction.UserActivated }),
      );
    });

    it('status igual ao atual: responde sem gravar nem auditar', async () => {
      locked.target = makeUser('alvo', RoleName.Usuario);

      await service.setStatus(gestor, 'alvo', true, IP);

      expect(save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('recusa desativar o ultimo ADMIN ativo (409)', async () => {
      locked.target = makeUser('outro-admin', RoleName.Admin);
      locked.activeAdminCount = 1;

      await expect(service.setStatus(admin, 'outro-admin', false, IP)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('desativa um ADMIN quando ha outro ADMIN ativo', async () => {
      locked.target = makeUser('outro-admin', RoleName.Admin);
      locked.activeAdminCount = 2;

      await expect(service.setStatus(admin, 'outro-admin', false, IP)).resolves.toMatchObject({
        ativo: false,
      });
    });

    it('ninguem altera o proprio status (403)', async () => {
      locked.target = makeUser(admin.id, RoleName.Admin);

      await expect(service.setStatus(admin, admin.id, false, IP)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('GESTOR nao ativa/desativa GESTOR nem ADMIN (403)', async () => {
      for (const role of [RoleName.Gestor, RoleName.Admin]) {
        locked.target = makeUser('alvo', role, { ativo: false });
        await expect(service.setStatus(gestor, 'alvo', true, IP)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
      expect(save).not.toHaveBeenCalled();
    });

    it('usuario inexistente: 404', async () => {
      await expect(service.setStatus(admin, 'x', false, IP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setRole', () => {
    it('troca o perfil e audita de/para', async () => {
      locked.target = makeUser('alvo', RoleName.Usuario);

      const saved = await service.setRole(gestor, 'alvo', RoleName.Operador, IP);

      expect(saved.role.nome).toBe(RoleName.Operador);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: AuditAction.UserRoleChanged,
          metadados: { alvoId: 'alvo', de: RoleName.Usuario, para: RoleName.Operador },
        }),
      );
    });

    it.each([RoleName.Gestor, RoleName.Admin])(
      'GESTOR nao promove ninguem a %s (403)',
      async (role) => {
        locked.target = makeUser('alvo', RoleName.Usuario);

        await expect(service.setRole(gestor, 'alvo', role, IP)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(save).not.toHaveBeenCalled();
      },
    );

    it('ninguem altera o proprio perfil, nem para se promover (403)', async () => {
      locked.target = makeUser(gestor.id, RoleName.Gestor);

      await expect(service.setRole(gestor, gestor.id, RoleName.Admin, IP)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      locked.target = makeUser(admin.id, RoleName.Admin);
      await expect(service.setRole(admin, admin.id, RoleName.Usuario, IP)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('recusa rebaixar o ultimo ADMIN ativo (409)', async () => {
      locked.target = makeUser('outro-admin', RoleName.Admin);
      locked.activeAdminCount = 1;

      await expect(
        service.setRole(admin, 'outro-admin', RoleName.Gestor, IP),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rebaixar um ADMIN inativo nao esbarra na regra do ultimo ADMIN', async () => {
      locked.target = makeUser('outro-admin', RoleName.Admin, { ativo: false });
      locked.activeAdminCount = 1;

      await expect(
        service.setRole(admin, 'outro-admin', RoleName.Gestor, IP),
      ).resolves.toMatchObject({ role: { nome: RoleName.Gestor } });
    });

    it('perfil igual ao atual: responde sem gravar nem auditar', async () => {
      locked.target = makeUser('alvo', RoleName.Usuario);

      await service.setRole(gestor, 'alvo', RoleName.Usuario, IP);

      expect(save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
