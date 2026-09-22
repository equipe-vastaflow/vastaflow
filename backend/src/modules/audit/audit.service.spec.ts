import type { UserDirectoryService } from '../users/user-directory.service';
import { AuditAction, AuditModuleName } from './audit-action.enum';
import type { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import type { AuditLog } from './entities/audit-log.entity';

describe('AuditService', () => {
  let repository: jest.Mocked<Pick<AuditRepository, 'create' | 'findLatest' | 'findPage'>>;
  let userDirectory: jest.Mocked<Pick<UserDirectoryService, 'findByIds'>>;
  let service: AuditService;

  /** Evento minimo; so os campos que estes testes usam importam. */
  const evento = (id: string, usuarioId: string | null): AuditLog =>
    ({ id, usuarioId }) as AuditLog;

  beforeEach(() => {
    repository = {
      create: jest.fn().mockResolvedValue(undefined),
      findLatest: jest.fn(),
      findPage: jest.fn().mockResolvedValue([[], 0]),
    };
    userDirectory = { findByIds: jest.fn().mockResolvedValue(new Map()) };
    service = new AuditService(
      repository as unknown as AuditRepository,
      userDirectory as unknown as UserDirectoryService,
    );
  });

  it('grava o evento completo', async () => {
    await service.record({
      usuarioId: 'user-1',
      acao: AuditAction.Login,
      modulo: AuditModuleName.Auth,
      descricao: 'Login realizado',
      ip: '10.0.0.5',
    });

    expect(repository.create).toHaveBeenCalledWith({
      usuarioId: 'user-1',
      acao: 'LOGIN',
      modulo: 'AUTH',
      descricao: 'Login realizado',
      ip: '10.0.0.5',
      metadados: null,
    });
  });

  it('grava null quando nao ha usuario, IP nem metadados', async () => {
    await service.record({
      acao: AuditAction.LoginFailed,
      modulo: AuditModuleName.Auth,
      descricao: 'x',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: null, ip: null, metadados: null }),
    );
  });

  it('grava os metadados ja higienizados', async () => {
    await service.record({
      acao: AuditAction.LoginFailed,
      modulo: AuditModuleName.Auth,
      descricao: 'x',
      metadados: { motivo: 'CREDENCIAIS_INVALIDAS', senha: 'Senha1234' },
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadados: { motivo: 'CREDENCIAIS_INVALIDAS', senha: '[REMOVIDO]' },
      }),
    );
  });

  it('trunca descricao maior que a coluna em vez de falhar', async () => {
    await service.record({
      acao: AuditAction.LoginFailed,
      modulo: AuditModuleName.Auth,
      descricao: 'a'.repeat(900),
    });

    const saved = repository.create.mock.calls[0]?.[0];
    expect(saved?.descricao).toHaveLength(500);
  });

  it('falha ao gravar NAO derruba a operacao auditada', async () => {
    repository.create.mockRejectedValue(new Error('banco indisponivel'));
    const logError = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    await expect(
      service.record({
        acao: AuditAction.Login,
        modulo: AuditModuleName.Auth,
        descricao: 'x',
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalled();
  });

  describe('findPage', () => {
    it('converte a pagina (1-based) no deslocamento do banco', async () => {
      await service.findPage(1, 20);
      expect(repository.findPage).toHaveBeenCalledWith(0, 20);

      await service.findPage(2, 20);
      expect(repository.findPage).toHaveBeenLastCalledWith(20, 20);

      await service.findPage(5, 10);
      expect(repository.findPage).toHaveBeenLastCalledWith(40, 10);
    });

    it('devolve os itens e o total vindos do banco', async () => {
      const log = evento('log-1', null);
      repository.findPage.mockResolvedValue([[log], 128]);

      await expect(service.findPage(3, 20)).resolves.toEqual({
        items: [{ log, autor: undefined }],
        total: 128,
      });
    });

    it('pagina vazia mantem o total, sem virar erro', async () => {
      repository.findPage.mockResolvedValue([[], 42]);

      await expect(service.findPage(99, 20)).resolves.toEqual({ items: [], total: 42 });
      // Sem eventos nao ha responsavel a buscar.
      expect(userDirectory.findByIds).toHaveBeenCalledWith([]);
    });
  });

  describe('findPage: responsavel', () => {
    const maria = { id: 'user-1', nome: 'Maria Silva', email: 'maria@example.com' };
    const joao = { id: 'user-2', nome: 'Joao Souza', email: 'joao@example.com' };

    it('identifica o responsavel de cada evento', async () => {
      repository.findPage.mockResolvedValue([[evento('a', 'user-1'), evento('b', 'user-2')], 2]);
      userDirectory.findByIds.mockResolvedValue(
        new Map([
          ['user-1', maria],
          ['user-2', joao],
        ]),
      );

      const { items } = await service.findPage(1, 20);

      expect(items.map((item) => item.autor)).toEqual([maria, joao]);
    });

    it('resolve todos os responsaveis numa UNICA busca, sem N+1', async () => {
      repository.findPage.mockResolvedValue([
        [
          evento('a', 'user-1'),
          evento('b', 'user-1'),
          evento('c', 'user-2'),
          evento('d', null),
          evento('e', 'user-1'),
        ],
        5,
      ]);
      userDirectory.findByIds.mockResolvedValue(
        new Map([
          ['user-1', maria],
          ['user-2', joao],
        ]),
      );

      const { items } = await service.findPage(1, 20);

      expect(userDirectory.findByIds).toHaveBeenCalledTimes(1);
      // Uma chamada so, com os ids dos eventos que tem usuario.
      expect(userDirectory.findByIds).toHaveBeenCalledWith([
        'user-1',
        'user-1',
        'user-2',
        'user-1',
      ]);
      expect(items.map((item) => item.autor?.nome)).toEqual([
        'Maria Silva',
        'Maria Silva',
        'Joao Souza',
        undefined,
        'Maria Silva',
      ]);
    });

    it('evento sem usuario nao tem responsavel', async () => {
      repository.findPage.mockResolvedValue([[evento('a', null)], 1]);

      const { items } = await service.findPage(1, 20);

      expect(items[0]?.autor).toBeUndefined();
      expect(userDirectory.findByIds).toHaveBeenCalledWith([]);
    });

    it('usuario que nao existe mais: sem responsavel, e o evento continua na lista', async () => {
      repository.findPage.mockResolvedValue([[evento('a', 'removido')], 1]);
      userDirectory.findByIds.mockResolvedValue(new Map());

      const { items } = await service.findPage(1, 20);

      expect(items).toHaveLength(1);
      expect(items[0]?.autor).toBeUndefined();
      expect(items[0]?.log.usuarioId).toBe('removido');
    });
  });
});
