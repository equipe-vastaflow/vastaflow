import type { Permission } from '../permissions/entities/permission.entity';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import type { User } from '../users/entities/user.entity';
import type { UsersService } from '../users/users.service';
import { DatabaseIdentityResolver } from './database-identity.resolver';
import type { ExternalIdentityLink } from './entities/external-identity-link.entity';
import type { ExternalIdentitiesRepository } from './external-identities.repository';
import { IdentityChannel } from './external-identity.enums';

const TELEGRAM = { channel: 'telegram', externalId: '4242' };

function makeUser(
  overrides: Partial<User> = {},
  codes: string[] = [],
  nome: RoleName = RoleName.Usuario,
): User {
  const role: Role = {
    id: 'role',
    nome,
    descricao: '',
    permissions: codes.map((code) => ({ id: code, code }) as Permission),
    createdAt: new Date(),
  };
  return {
    id: 'usuario-vinculado',
    nome: 'Pessoa',
    email: 'pessoa@vasta.test',
    senhaHash: '$2b$04$hash',
    ativo: true,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const LINK: ExternalIdentityLink = {
  id: 'link-1',
  canal: IdentityChannel.Telegram,
  idExterno: '4242',
  usuarioId: 'usuario-vinculado',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('DatabaseIdentityResolver', () => {
  let links: { findByIdentity: jest.Mock<Promise<ExternalIdentityLink | null>, [string, string]> };
  let users: { findById: jest.Mock<Promise<User | null>, [string]> };
  let resolver: DatabaseIdentityResolver;

  beforeEach(() => {
    links = { findByIdentity: jest.fn((_c: string, _e: string) => Promise.resolve(LINK)) };
    users = { findById: jest.fn((_id: string) => Promise.resolve<User | null>(makeUser())) };
    resolver = new DatabaseIdentityResolver(
      links as unknown as ExternalIdentitiesRepository,
      users as unknown as UsersService,
    );
  });

  it('vinculo existente: devolve o usuario interno do vinculo', async () => {
    const user = await resolver.resolve(TELEGRAM);

    expect(links.findByIdentity).toHaveBeenCalledWith('telegram', '4242');
    expect(users.findById).toHaveBeenCalledWith('usuario-vinculado');
    expect(user?.id).toBe('usuario-vinculado');
  });

  it('sem vinculo: null, sem nem consultar usuarios', async () => {
    links.findByIdentity.mockResolvedValue(null);

    expect(await resolver.resolve(TELEGRAM)).toBeNull();
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('usuario vinculado mas inativo: null', async () => {
    users.findById.mockResolvedValue(makeUser({ ativo: false }));

    expect(await resolver.resolve(TELEGRAM)).toBeNull();
  });

  it('usuario vinculado que nao existe mais: null', async () => {
    users.findById.mockResolvedValue(null);

    expect(await resolver.resolve(TELEGRAM)).toBeNull();
  });

  it('perfil e permissoes sao os ATUAIS do usuario, lidos a cada mensagem', async () => {
    users.findById
      .mockResolvedValueOnce(makeUser({}, []))
      .mockResolvedValueOnce(makeUser({}, ['finance:read'], RoleName.Gestor));

    const antes = await resolver.resolve(TELEGRAM);
    const depois = await resolver.resolve(TELEGRAM);

    expect(antes).toMatchObject({ role: RoleName.Usuario, permissions: [] });
    expect(depois).toMatchObject({ role: RoleName.Gestor, permissions: ['finance:read'] });
    expect(users.findById).toHaveBeenCalledTimes(2);
  });

  it('erro de banco propaga (o adaptador o trata como nao vinculado)', async () => {
    links.findByIdentity.mockRejectedValue(new Error('banco fora'));

    await expect(resolver.resolve(TELEGRAM)).rejects.toThrow('banco fora');
  });

  it('o usuario sai do vinculo, nunca de um campo da identidade', async () => {
    const tentativa = { ...TELEGRAM, userId: 'admin-interno' } as typeof TELEGRAM;

    await resolver.resolve(tentativa);

    expect(users.findById).toHaveBeenCalledWith('usuario-vinculado');
    expect(users.findById).not.toHaveBeenCalledWith('admin-interno');
  });
});
