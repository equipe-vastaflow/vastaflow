import { AuditAction, AuditModuleName } from './audit-action.enum';
import type { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let repository: jest.Mocked<Pick<AuditRepository, 'create' | 'findLatest'>>;
  let service: AuditService;

  beforeEach(() => {
    repository = { create: jest.fn().mockResolvedValue(undefined), findLatest: jest.fn() };
    service = new AuditService(repository as unknown as AuditRepository);
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
});
