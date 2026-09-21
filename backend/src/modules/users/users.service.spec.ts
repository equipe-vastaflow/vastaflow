import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import type { RolesService } from '../roles/roles.service';
import type { User } from './entities/user.entity';
import type { PasswordService } from './password.service';
import { DuplicateEmailError, type UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const role = { id: 'role-1', nome: RoleName.Usuario, permissions: [] } as unknown as Role;
const existing = { id: 'user-0', email: 'maria@vasta.test' } as User;

describe('UsersService', () => {
  let repository: jest.Mocked<
    Pick<UsersRepository, 'findByEmail' | 'findById' | 'create' | 'findAll'>
  >;
  let rolesService: jest.Mocked<Pick<RolesService, 'getByName'>>;
  let passwordService: jest.Mocked<Pick<PasswordService, 'hash'>>;
  let service: UsersService;

  const input = {
    nome: '  Maria Silva ',
    email: '  Maria@Vasta.TEST ',
    senha: 'Senha1234',
    role: RoleName.Usuario,
  };

  beforeEach(() => {
    repository = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: object) => Promise.resolve({ id: 'user-1', ...data })),
      findAll: jest.fn(),
    };
    rolesService = { getByName: jest.fn().mockResolvedValue(role) };
    passwordService = { hash: jest.fn().mockResolvedValue('$2b$hash') };
    service = new UsersService(
      repository as unknown as UsersRepository,
      rolesService as unknown as RolesService,
      passwordService as unknown as PasswordService,
    );
  });

  it('grava o hash (nunca a senha), o e-mail normalizado e o nome sem espacos sobrando', async () => {
    await service.create(input);

    expect(passwordService.hash).toHaveBeenCalledWith('Senha1234');
    expect(repository.create).toHaveBeenCalledWith({
      nome: 'Maria Silva',
      email: 'maria@vasta.test',
      senhaHash: '$2b$hash',
      role,
    });
    expect(JSON.stringify(repository.create.mock.calls)).not.toContain('Senha1234');
  });

  it('verifica duplicidade pelo e-mail normalizado', async () => {
    await service.create(input);

    expect(repository.findByEmail).toHaveBeenCalledWith('maria@vasta.test');
  });

  it('lanca 409 quando o e-mail ja existe e nao chega a criar nada', async () => {
    repository.findByEmail.mockResolvedValue(existing);

    await expect(service.create(input)).rejects.toBeInstanceOf(ConflictException);

    expect(repository.create).not.toHaveBeenCalled();
    expect(passwordService.hash).not.toHaveBeenCalled();
  });

  it('converte a violacao de unicidade do banco (corrida) em 409', async () => {
    repository.create.mockRejectedValue(new DuplicateEmailError());

    await expect(service.create(input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('nao esconde erros inesperados do banco', async () => {
    repository.create.mockRejectedValue(new Error('conexao perdida'));

    await expect(service.create(input)).rejects.toThrow('conexao perdida');
  });

  it('propaga o erro quando o perfil nao existe (seed nao executado)', async () => {
    rolesService.getByName.mockRejectedValue(new InternalServerErrorException());

    await expect(service.create(input)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('findByEmail normaliza o e-mail antes de consultar', async () => {
    repository.findByEmail.mockResolvedValue(existing);

    await service.findByEmail('  MARIA@vasta.test ');

    expect(repository.findByEmail).toHaveBeenCalledWith('maria@vasta.test');
  });
});
