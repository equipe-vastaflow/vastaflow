import type { AuditService } from '../audit/audit.service';
import type { AuditLog } from '../audit/entities/audit-log.entity';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PermissionCode } from '../permissions/permission-code.enum';
import { RoleName } from '../roles/role-name.enum';
import type { UsersService } from '../users/users.service';
import { DashboardService, RECENT_AUDIT_LIMIT } from './dashboard.service';

function actor(role: RoleName, permissions: PermissionCode[]): AuthenticatedUser {
  return {
    id: 'actor-1',
    nome: 'Quem Consulta',
    email: 'quem@example.com',
    role,
    permissions,
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const ADMIN = actor(RoleName.Admin, []);
const GESTOR = actor(RoleName.Gestor, [PermissionCode.UsersRead, PermissionCode.AuditRead]);
const USUARIO = actor(RoleName.Usuario, []);

function log(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'log-1',
    usuarioId: 'user-1',
    acao: 'LOGIN',
    modulo: 'AUTH',
    descricao: 'Login realizado',
    ip: '10.0.0.5',
    metadados: { motivo: 'TESTE' },
    createdAt: new Date('2026-09-22T12:00:00.000Z'),
    ...overrides,
  };
}

describe('DashboardService', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'countByStatus' | 'findNamesByIds'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'count' | 'findLatest'>>;
  let service: DashboardService;

  beforeEach(() => {
    usersService = {
      countByStatus: jest.fn().mockResolvedValue({ total: 12, ativos: 10, inativos: 2 }),
      findNamesByIds: jest.fn().mockResolvedValue(new Map([['user-1', 'Maria Silva']])),
    };
    auditService = {
      count: jest.fn().mockResolvedValue(128),
      findLatest: jest.fn().mockResolvedValue([log()]),
    };
    service = new DashboardService(
      usersService as unknown as UsersService,
      auditService as unknown as AuditService,
    );
  });

  describe('secoes por permissao', () => {
    it('ADMIN recebe tudo, mesmo sem as permissoes listadas no perfil', async () => {
      const summary = await service.getSummary(ADMIN);

      expect(summary.usuarios).toEqual({ total: 12, ativos: 10, inativos: 2 });
      expect(summary.auditoria?.total).toBe(128);
    });

    it('perfil com as duas permissoes recebe as duas secoes', async () => {
      const summary = await service.getSummary(GESTOR);

      expect(Object.keys(summary).sort()).toEqual(['auditoria', 'usuarios']);
    });

    it('so com users:read: nenhuma consulta de auditoria e feita', async () => {
      const summary = await service.getSummary(
        actor(RoleName.Operador, [PermissionCode.UsersRead]),
      );

      expect(summary.usuarios).toBeDefined();
      expect(summary).not.toHaveProperty('auditoria');
      expect(auditService.count).not.toHaveBeenCalled();
      expect(auditService.findLatest).not.toHaveBeenCalled();
    });

    it('so com audit:read: nenhuma consulta de usuarios e feita', async () => {
      const summary = await service.getSummary(
        actor(RoleName.Operador, [PermissionCode.AuditRead]),
      );

      expect(summary.auditoria).toBeDefined();
      expect(summary).not.toHaveProperty('usuarios');
      expect(usersService.countByStatus).not.toHaveBeenCalled();
    });

    it('perfil sem permissao recebe resumo vazio, sem consultar o banco', async () => {
      const summary = await service.getSummary(USUARIO);

      expect(summary).toEqual({});
      expect(usersService.countByStatus).not.toHaveBeenCalled();
      expect(auditService.count).not.toHaveBeenCalled();
      expect(auditService.findLatest).not.toHaveBeenCalled();
    });
  });

  describe('auditoria recente', () => {
    it('pede apenas os ultimos eventos ao banco, nao a tabela inteira', async () => {
      await service.getSummary(GESTOR);

      expect(auditService.findLatest).toHaveBeenCalledWith(RECENT_AUDIT_LIMIT);
    });

    it('resolve o nome dos autores numa unica consulta (sem N+1)', async () => {
      auditService.findLatest.mockResolvedValue([
        log({ id: 'a', usuarioId: 'user-1' }),
        log({ id: 'b', usuarioId: 'user-1' }),
        log({ id: 'c', usuarioId: 'user-2' }),
      ]);
      usersService.findNamesByIds.mockResolvedValue(
        new Map([
          ['user-1', 'Maria Silva'],
          ['user-2', 'Joao Souza'],
        ]),
      );

      const summary = await service.getSummary(GESTOR);

      expect(usersService.findNamesByIds).toHaveBeenCalledTimes(1);
      expect(usersService.findNamesByIds).toHaveBeenCalledWith(['user-1', 'user-1', 'user-2']);
      expect(summary.auditoria?.recentes.map((evento) => evento.usuario?.nome)).toEqual([
        'Maria Silva',
        'Maria Silva',
        'Joao Souza',
      ]);
    });

    it('evento sem usuario identificado vem com usuario nulo', async () => {
      auditService.findLatest.mockResolvedValue([log({ usuarioId: null, acao: 'LOGIN_FAILED' })]);
      usersService.findNamesByIds.mockResolvedValue(new Map());

      const summary = await service.getSummary(GESTOR);

      expect(summary.auditoria?.recentes[0]?.usuario).toBeNull();
      expect(usersService.findNamesByIds).toHaveBeenCalledWith([]);
    });

    it('usuario que nao existe mais vem como nulo, sem quebrar', async () => {
      auditService.findLatest.mockResolvedValue([log({ usuarioId: 'removido' })]);
      usersService.findNamesByIds.mockResolvedValue(new Map());

      const summary = await service.getSummary(GESTOR);

      expect(summary.auditoria?.recentes[0]?.usuario).toBeNull();
    });

    it('nao expoe IP nem metadados do evento', async () => {
      const summary = await service.getSummary(GESTOR);
      const evento = summary.auditoria?.recentes[0];

      expect(evento).not.toHaveProperty('ip');
      expect(evento).not.toHaveProperty('metadados');
      expect(JSON.stringify(summary)).not.toContain('10.0.0.5');
    });
  });
});
