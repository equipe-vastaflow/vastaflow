import type { AuditEvent, AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import { LinkConfirmationOutcome } from '../integrations/channels/channel-link';
import type { ExternalIdentity } from '../integrations/channels/incoming-message';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import type { User } from '../users/entities/user.entity';
import type { UsersService } from '../users/users.service';
import type { ExternalIdentityLink } from './entities/external-identity-link.entity';
import type { IdentityLinkRequest } from './entities/identity-link-request.entity';
import { IdentityChannel, LinkRequestStatus } from './external-identity.enums';
import type {
  ConfirmResult,
  IdentityLinkRequestsRepository,
} from './identity-link-requests.repository';
import { hashLinkCode, normalizeLinkCode } from './link-code';
import { LinkConfirmationService } from './link-confirmation.service';

const CODIGO = 'K7QM-2XRA-9CVB';
const HASH = hashLinkCode(normalizeLinkCode(CODIGO) as string);
const REMETENTE: ExternalIdentity = { channel: 'telegram', externalId: '4242' };

function request(overrides: Partial<IdentityLinkRequest> = {}): IdentityLinkRequest {
  return {
    id: 'sol-1',
    canal: IdentityChannel.Telegram,
    usuarioId: 'usuario-alvo',
    codigoHash: HASH,
    status: LinkRequestStatus.Pendente,
    pendenteChave: 'usuario-alvo:telegram',
    expiraEm: new Date(Date.now() + 60_000),
    criadoPorId: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function user(ativo = true): User {
  return {
    id: 'usuario-alvo',
    nome: 'Alvo',
    email: 'alvo@vasta.test',
    senhaHash: '$2b$04$hash',
    ativo,
    role: { id: 'r', nome: RoleName.Usuario, descricao: '', permissions: [] } as unknown as Role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const LINK: ExternalIdentityLink = {
  id: 'link-1',
  canal: IdentityChannel.Telegram,
  idExterno: '4242',
  usuarioId: 'usuario-alvo',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('LinkConfirmationService', () => {
  let requests: {
    findByCodeHash: jest.Mock<Promise<IdentityLinkRequest | null>, [string]>;
    confirmAndLink: jest.Mock<Promise<ConfirmResult>, [IdentityLinkRequest, string]>;
  };
  let users: { findById: jest.Mock<Promise<User | null>, [string]> };
  let audit: { record: jest.Mock<Promise<void>, [AuditEvent]> };
  let service: LinkConfirmationService;

  beforeEach(() => {
    requests = {
      findByCodeHash: jest.fn((_h: string) =>
        Promise.resolve<IdentityLinkRequest | null>(request()),
      ),
      confirmAndLink: jest.fn((_r: IdentityLinkRequest, _e: string) =>
        Promise.resolve<ConfirmResult>({ kind: 'confirmed', link: LINK }),
      ),
    };
    users = { findById: jest.fn((_id: string) => Promise.resolve<User | null>(user())) };
    audit = { record: jest.fn((_e: AuditEvent) => Promise.resolve()) };
    service = new LinkConfirmationService(
      requests as unknown as IdentityLinkRequestsRepository,
      users as unknown as UsersService,
      audit as unknown as AuditService,
    );
  });

  describe('o que nao e confirmacao segue o fluxo normal', () => {
    it.each(['/ajuda', '/status', 'oi', '', '/vincularx ABC'])(
      '"%s": NotAttempted',
      async (texto) => {
        expect(await service.tryConfirm(REMETENTE, texto)).toBe(
          LinkConfirmationOutcome.NotAttempted,
        );
        expect(requests.findByCodeHash).not.toHaveBeenCalled();
      },
    );
  });

  describe('confirmacao valida', () => {
    it('cria o vinculo para o REMETENTE e o usuario da SOLICITACAO', async () => {
      expect(await service.tryConfirm(REMETENTE, `/vincular ${CODIGO}`)).toBe(
        LinkConfirmationOutcome.Confirmed,
      );
      expect(requests.findByCodeHash).toHaveBeenCalledWith(HASH);
      const [solicitacao, idExterno] = requests.confirmAndLink.mock.calls[0];
      expect(solicitacao.usuarioId).toBe('usuario-alvo');
      expect(idExterno).toBe('4242');
    });

    it('aceita o codigo em minusculas e sem hifens', async () => {
      expect(await service.tryConfirm(REMETENTE, '/vincular k7qm2xra9cvb')).toBe(
        LinkConfirmationOutcome.Confirmed,
      );
    });

    it('audita sem codigo nem hash; quem age e o usuario vinculado', async () => {
      await service.tryConfirm(REMETENTE, `/vincular ${CODIGO}`);

      const [evento] = audit.record.mock.calls[0];
      expect(evento).toMatchObject({
        usuarioId: 'usuario-alvo',
        acao: AuditAction.ExternalIdentityLinked,
        metadados: {
          alvoId: 'usuario-alvo',
          solicitacaoId: 'sol-1',
          vinculoId: 'link-1',
          canal: 'telegram',
          idExterno: '4242',
        },
      });
      const registrado = JSON.stringify(evento);
      expect(registrado).not.toContain('K7QM');
      expect(registrado).not.toContain(HASH);
    });
  });

  describe('recusas: sempre o mesmo desfecho, nada de vinculo', () => {
    it.each([
      ['sem codigo', '/vincular'],
      ['codigo mal formado', '/vincular 123'],
      ['userId e telegramId como argumentos', '/vincular 123 usuario-alvo'],
      ['codigo + userId', `/vincular ${CODIGO} admin`],
      ['id interno no lugar do codigo', '/vincular 3f2c1a7e-0000-4000-8000-000000000000'],
    ])('%s: nem consulta o banco', async (_caso, texto) => {
      expect(await service.tryConfirm(REMETENTE, texto)).toBe(LinkConfirmationOutcome.Rejected);
      expect(requests.findByCodeHash).not.toHaveBeenCalled();
      expect(requests.confirmAndLink).not.toHaveBeenCalled();
    });

    it.each([
      [
        'codigo inexistente',
        (): void => {
          requests.findByCodeHash.mockResolvedValue(null);
        },
      ],
      [
        'codigo expirado',
        (): void => {
          requests.findByCodeHash.mockResolvedValue(
            request({ expiraEm: new Date(Date.now() - 1) }),
          );
        },
      ],
      [
        'usuario inativo',
        (): void => {
          users.findById.mockResolvedValue(user(false));
        },
      ],
      [
        'usuario removido',
        (): void => {
          users.findById.mockResolvedValue(null);
        },
      ],
    ])('%s: Rejected, sem vinculo', async (_caso, preparar) => {
      preparar();

      expect(await service.tryConfirm(REMETENTE, `/vincular ${CODIGO}`)).toBe(
        LinkConfirmationOutcome.Rejected,
      );
      expect(requests.confirmAndLink).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('codigo ja usado ou cancelado (a transacao nao o toma): Rejected', async () => {
      requests.confirmAndLink.mockResolvedValue({ kind: 'not-pending' });

      expect(await service.tryConfirm(REMETENTE, `/vincular ${CODIGO}`)).toBe(
        LinkConfirmationOutcome.Rejected,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('canal do remetente diferente do da solicitacao: Rejected', async () => {
      expect(
        await service.tryConfirm(
          { channel: 'whatsapp', externalId: '4242' },
          `/vincular ${CODIGO}`,
        ),
      ).toBe(LinkConfirmationOutcome.Rejected);
    });

    it('conta externa ja vinculada: AlreadyLinked, sem auditoria', async () => {
      requests.confirmAndLink.mockResolvedValue({ kind: 'identity-taken' });

      expect(await service.tryConfirm(REMETENTE, `/vincular ${CODIGO}`)).toBe(
        LinkConfirmationOutcome.AlreadyLinked,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
