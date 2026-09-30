import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditEvent, AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { Permission } from '../permissions/entities/permission.entity';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import type { User } from '../users/entities/user.entity';
import type { UsersService } from '../users/users.service';
import type { ExternalIdentityLink } from './entities/external-identity-link.entity';
import type { IdentityLinkRequest } from './entities/identity-link-request.entity';
import type { ExternalIdentitiesRepository } from './external-identities.repository';
import { ExternalIdentitiesService } from './external-identities.service';
import { IdentityChannel, LINK_REQUEST_TTL_MS, LinkRequestStatus } from './external-identity.enums';
import {
  DuplicatePendingRequestError,
  type IdentityLinkRequestsRepository,
  type NewLinkRequest,
} from './identity-link-requests.repository';
import { hashLinkCode, normalizeLinkCode } from './link-code';

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
    permissions: user.role.permissions.map((p) => p.code),
    ativo: user.ativo,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

const ADMIN = actorFrom(makeUser('admin', RoleName.Admin));
const GESTOR = actorFrom(makeUser('gestor', RoleName.Gestor));
const IP = '203.0.113.9';
const TELEGRAM = IdentityChannel.Telegram;

function linkFor(usuarioId: string): ExternalIdentityLink {
  return {
    id: 'link-1',
    canal: IdentityChannel.Telegram,
    idExterno: '123456789',
    usuarioId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function requestFrom(
  data: NewLinkRequest,
  overrides: Partial<IdentityLinkRequest> = {},
): IdentityLinkRequest {
  return {
    id: 'sol-1',
    ...data,
    status: LinkRequestStatus.Pendente,
    pendenteChave: `${data.usuarioId}:${data.canal}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ExternalIdentitiesService', () => {
  let links: {
    findByUser: jest.Mock<Promise<ExternalIdentityLink[]>, [string]>;
    findByIdForUser: jest.Mock<Promise<ExternalIdentityLink | null>, [string, string]>;
    deleteForUser: jest.Mock<Promise<number>, [string, string]>;
  };
  let requests: {
    findPending: jest.Mock<Promise<IdentityLinkRequest | null>, [string, IdentityChannel]>;
    findPendingByUser: jest.Mock<Promise<IdentityLinkRequest[]>, [string]>;
    create: jest.Mock<Promise<IdentityLinkRequest>, [NewLinkRequest]>;
    close: jest.Mock<Promise<number>, [string, string, LinkRequestStatus]>;
  };
  let users: { findById: jest.Mock<Promise<User | null>, [string]> };
  let audit: { record: jest.Mock<Promise<void>, [AuditEvent]> };
  let service: ExternalIdentitiesService;

  beforeEach(() => {
    links = {
      findByUser: jest.fn((_u: string) => Promise.resolve<ExternalIdentityLink[]>([])),
      findByIdForUser: jest.fn((_id: string, u: string) =>
        Promise.resolve<ExternalIdentityLink | null>(linkFor(u)),
      ),
      deleteForUser: jest.fn((_id: string, _u: string) => Promise.resolve(1)),
    };
    requests = {
      findPending: jest.fn((_u: string, _c: IdentityChannel) =>
        Promise.resolve<IdentityLinkRequest | null>(null),
      ),
      findPendingByUser: jest.fn((_u: string) => Promise.resolve<IdentityLinkRequest[]>([])),
      create: jest.fn((data: NewLinkRequest) => Promise.resolve(requestFrom(data))),
      close: jest.fn((_id: string, _u: string, _s: LinkRequestStatus) => Promise.resolve(1)),
    };
    users = {
      findById: jest.fn((id: string) =>
        Promise.resolve<User | null>(makeUser(id, RoleName.Usuario)),
      ),
    };
    audit = { record: jest.fn((_e: AuditEvent) => Promise.resolve()) };
    service = new ExternalIdentitiesService(
      links as unknown as ExternalIdentitiesRepository,
      requests as unknown as IdentityLinkRequestsRepository,
      users as unknown as UsersService,
      audit as unknown as AuditService,
    );
  });

  describe('requestLink', () => {
    it('cria SOLICITACAO pendente, nao vinculo: nada de id externo, usuario da rota', async () => {
      const { request } = await service.requestLink(ADMIN, 'alvo', TELEGRAM, IP);

      const [dados] = requests.create.mock.calls[0];
      expect(dados).toMatchObject({ canal: TELEGRAM, usuarioId: 'alvo', criadoPorId: 'admin' });
      expect(dados).not.toHaveProperty('idExterno');
      expect(request.status).toBe(LinkRequestStatus.Pendente);
      expect(links.findByUser).not.toHaveBeenCalled();
    });

    it('grava so o HASH do codigo devolvido - o codigo em claro nunca vai ao banco', async () => {
      const { codigo } = await service.requestLink(ADMIN, 'alvo', TELEGRAM, IP);

      const [dados] = requests.create.mock.calls[0];
      expect(dados.codigoHash).toBe(hashLinkCode(normalizeLinkCode(codigo) as string));
      expect(JSON.stringify(dados)).not.toContain(codigo);
      expect(JSON.stringify(dados)).not.toContain(codigo.replace(/-/g, ''));
    });

    it('expira em 15 minutos', async () => {
      const antes = Date.now();

      await service.requestLink(ADMIN, 'alvo', TELEGRAM, IP);

      const expiraEm = requests.create.mock.calls[0][0].expiraEm.getTime();
      expect(expiraEm).toBeGreaterThanOrEqual(antes + LINK_REQUEST_TTL_MS);
      expect(expiraEm).toBeLessThanOrEqual(Date.now() + LINK_REQUEST_TTL_MS);
    });

    it('cada solicitacao tem um codigo novo', async () => {
      const a = await service.requestLink(ADMIN, 'alvo', TELEGRAM, IP);
      const b = await service.requestLink(ADMIN, 'alvo', TELEGRAM, IP);

      expect(a.codigo).not.toBe(b.codigo);
    });

    it('GESTOR inicia para quem esta abaixo dele', async () => {
      await expect(service.requestLink(GESTOR, 'alvo', TELEGRAM, IP)).resolves.toBeDefined();
    });

    it.each([RoleName.Gestor, RoleName.Admin])(
      'GESTOR nao inicia para um %s: 403, nada criado',
      async (role) => {
        users.findById.mockResolvedValue(makeUser('outro', role));

        await expect(service.requestLink(GESTOR, 'outro', TELEGRAM, IP)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(requests.create).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it('o proprio usuario pode iniciar a sua (mesma regra da edicao)', async () => {
      users.findById.mockResolvedValue(makeUser('gestor', RoleName.Gestor));

      await expect(service.requestLink(GESTOR, 'gestor', TELEGRAM, IP)).resolves.toBeDefined();
    });

    it('usuario inexistente: 404', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.requestLink(ADMIN, 'x', TELEGRAM, IP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('usuario inativo: 409, nada criado', async () => {
      users.findById.mockResolvedValue(makeUser('alvo', RoleName.Usuario, { ativo: false }));

      await expect(service.requestLink(ADMIN, 'alvo', TELEGRAM, IP)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('ja ha pendente valida: 409, nada criado', async () => {
      requests.findPending.mockResolvedValue(
        requestFrom({
          canal: TELEGRAM,
          usuarioId: 'alvo',
          codigoHash: 'h',
          expiraEm: new Date(Date.now() + 60_000),
          criadoPorId: 'admin',
        }),
      );

      await expect(service.requestLink(ADMIN, 'alvo', TELEGRAM, IP)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('pendente vencida: e encerrada como EXPIRADA e a nova e criada', async () => {
      requests.findPending.mockResolvedValue(
        requestFrom(
          {
            canal: TELEGRAM,
            usuarioId: 'alvo',
            codigoHash: 'h',
            expiraEm: new Date(Date.now() - 1),
            criadoPorId: 'admin',
          },
          { id: 'velha' },
        ),
      );

      await service.requestLink(ADMIN, 'alvo', TELEGRAM, IP);

      expect(requests.close).toHaveBeenCalledWith('velha', 'alvo', LinkRequestStatus.Expirada);
      expect(requests.create).toHaveBeenCalledTimes(1);
    });

    it('corrida: o indice recusa a segunda pendente -> 409', async () => {
      requests.create.mockRejectedValue(new DuplicatePendingRequestError());

      await expect(service.requestLink(ADMIN, 'alvo', TELEGRAM, IP)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('audita sem o codigo nem o hash', async () => {
      const { codigo } = await service.requestLink(ADMIN, 'alvo', TELEGRAM, IP);

      const [evento] = audit.record.mock.calls[0];
      expect(evento).toMatchObject({
        usuarioId: 'admin',
        acao: AuditAction.ExternalIdentityLinkRequested,
        modulo: AuditModuleName.Users,
        metadados: { alvoId: 'alvo', solicitacaoId: 'sol-1', canal: 'telegram' },
      });
      expect(Object.keys(evento.metadados ?? {}).sort()).toEqual(
        ['alvoId', 'canal', 'expiraEm', 'solicitacaoId'].sort(),
      );
      const registrado = JSON.stringify(evento);
      expect(registrado).not.toContain(codigo);
      expect(registrado).not.toContain(codigo.replace(/-/g, ''));
      expect(registrado).not.toContain(requests.create.mock.calls[0][0].codigoHash);
    });
  });

  describe('cancelRequest', () => {
    it('cancela a pendente do usuario e audita', async () => {
      await service.cancelRequest(ADMIN, 'alvo', 'sol-1', IP);

      expect(requests.close).toHaveBeenCalledWith('sol-1', 'alvo', LinkRequestStatus.Cancelada);
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        acao: AuditAction.ExternalIdentityLinkRequestCancelled,
        metadados: { alvoId: 'alvo', solicitacaoId: 'sol-1' },
      });
    });

    it('de outro usuario, inexistente ou ja encerrada: 404, sem auditoria', async () => {
      requests.close.mockResolvedValue(0);

      await expect(service.cancelRequest(ADMIN, 'alvo', 'sol-x', IP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('GESTOR nao cancela a de um ADMIN: 403', async () => {
      users.findById.mockResolvedValue(makeUser('chefe', RoleName.Admin));

      await expect(service.cancelRequest(GESTOR, 'chefe', 'sol-1', IP)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(requests.close).not.toHaveBeenCalled();
    });
  });

  describe('unlink', () => {
    it('remove o vinculo do usuario e audita', async () => {
      await service.unlink(ADMIN, 'alvo', 'link-1', IP);

      expect(links.findByIdForUser).toHaveBeenCalledWith('link-1', 'alvo');
      expect(links.deleteForUser).toHaveBeenCalledWith('link-1', 'alvo');
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        acao: AuditAction.ExternalIdentityUnlinked,
        metadados: { alvoId: 'alvo', vinculoId: 'link-1', canal: 'telegram' },
      });
    });

    it('vinculo de OUTRO usuario pela rota deste: 404, nada removido', async () => {
      links.findByIdForUser.mockResolvedValue(null);

      await expect(service.unlink(ADMIN, 'alvo', 'link-de-outro', IP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(links.deleteForUser).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('GESTOR nao remove vinculo de um ADMIN: 403', async () => {
      users.findById.mockResolvedValue(makeUser('chefe', RoleName.Admin));

      await expect(service.unlink(GESTOR, 'chefe', 'link-1', IP)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(links.deleteForUser).not.toHaveBeenCalled();
    });

    it('removido por outra requisicao no meio do caminho: 404, sem auditoria', async () => {
      links.deleteForUser.mockResolvedValue(0);

      await expect(service.unlink(ADMIN, 'alvo', 'link-1', IP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('usuario inativo: a remocao continua permitida (limpeza)', async () => {
      users.findById.mockResolvedValue(makeUser('alvo', RoleName.Usuario, { ativo: false }));

      await expect(service.unlink(ADMIN, 'alvo', 'link-1', IP)).resolves.toBeUndefined();
    });
  });

  describe('listagens', () => {
    it('usuario inexistente: 404 nas duas', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.list('x')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listPendingRequests('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('vinculos ativos e pendentes vem de fontes separadas', async () => {
      links.findByUser.mockResolvedValue([linkFor('alvo')]);

      expect(await service.list('alvo')).toHaveLength(1);
      expect(await service.listPendingRequests('alvo')).toEqual([]);
      expect(requests.findPendingByUser).toHaveBeenCalledWith('alvo');
    });
  });
});
