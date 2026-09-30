import type { Permission } from '../permissions/entities/permission.entity';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import type { User } from '../users/entities/user.entity';
import { toAuthenticatedUser } from './authenticated-user';

function makeUser(overrides: Partial<User> = {}): User {
  const role: Role = {
    id: 'role-gestor',
    nome: RoleName.Gestor,
    descricao: '',
    permissions: [{ id: 'p1', code: 'finance:read' } as Permission],
    createdAt: new Date(),
  };
  return {
    id: 'u-1',
    nome: 'Pessoa',
    email: 'pessoa@vasta.test',
    senhaHash: '$2b$04$hash',
    ativo: true,
    role,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('toAuthenticatedUser', () => {
  it('usuario ativo: perfil e permissoes vem do usuario lido agora', () => {
    expect(toAuthenticatedUser(makeUser())).toEqual({
      id: 'u-1',
      nome: 'Pessoa',
      email: 'pessoa@vasta.test',
      role: RoleName.Gestor,
      permissions: ['finance:read'],
      ativo: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('nunca expoe o hash da senha', () => {
    expect(toAuthenticatedUser(makeUser())).not.toHaveProperty('senhaHash');
  });

  it('inativo: null', () => {
    expect(toAuthenticatedUser(makeUser({ ativo: false }))).toBeNull();
  });

  it('inexistente: null', () => {
    expect(toAuthenticatedUser(null)).toBeNull();
  });
});
