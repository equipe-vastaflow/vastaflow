import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoleName } from '../roles/role-name.enum';
import type { UserDirectoryService } from '../users/user-directory.service';
import type { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import type { FinancialEntry } from './entities/financial-entry.entity';
import { FinancialEntryStatus, FinancialEntryType } from './financial-entry.enums';
import type { FinanceRepository } from './finance.repository';
import { FinanceService, OVERVIEW_LIMIT } from './finance.service';

const ACTOR: AuthenticatedUser = {
  id: 'user-1',
  nome: 'Maria Silva',
  email: 'maria@example.com',
  role: RoleName.Gestor,
  permissions: [],
  ativo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const IDENTIDADE = { id: ACTOR.id, nome: ACTOR.nome, email: ACTOR.email };

const VALID_DTO: CreateFinancialEntryDto = {
  tipo: FinancialEntryType.Despesa,
  descricao: 'Compra de insumos',
  valor: 1500.5,
  data: '2026-09-23',
  categoria: 'Insumos',
};

function entry(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: 'entry-1',
    tipo: FinancialEntryType.Despesa,
    descricao: 'Compra de insumos',
    valor: 1500.5,
    data: '2026-09-23',
    categoria: 'Insumos',
    status: FinancialEntryStatus.Pendente,
    observacao: null,
    criadoPorId: ACTOR.id,
    createdAt: new Date('2026-09-23T10:00:00.000Z'),
    updatedAt: new Date('2026-09-23T10:00:00.000Z'),
    ...overrides,
  };
}

describe('FinanceService', () => {
  let repository: jest.Mocked<
    Pick<FinanceRepository, 'findById' | 'findPage' | 'findLatest' | 'count' | 'create' | 'save'>
  >;
  let userDirectory: jest.Mocked<Pick<UserDirectoryService, 'findByIds'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: FinanceService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(entry()),
      findPage: jest.fn().mockResolvedValue([[entry()], 1]),
      findLatest: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((data: object) => Promise.resolve(entry(data))),
      save: jest.fn().mockImplementation((e: FinancialEntry) => Promise.resolve(e)),
    };
    userDirectory = { findByIds: jest.fn().mockResolvedValue(new Map([[ACTOR.id, IDENTIDADE]])) };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new FinanceService(
      repository as unknown as FinanceRepository,
      userDirectory as unknown as UserDirectoryService,
      auditService as unknown as AuditService,
    );
  });

  describe('create', () => {
    it('cria uma DESPESA com os dados informados', async () => {
      const { entry: criado } = await service.create(ACTOR, VALID_DTO, '10.0.0.5');

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tipo: FinancialEntryType.Despesa,
          descricao: 'Compra de insumos',
          valor: 1500.5,
          data: '2026-09-23',
          categoria: 'Insumos',
        }),
      );
      expect(criado.tipo).toBe(FinancialEntryType.Despesa);
    });

    it('cria uma RECEITA', async () => {
      await service.create(ACTOR, { ...VALID_DTO, tipo: FinancialEntryType.Receita }, null);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: FinancialEntryType.Receita }),
      );
    });

    it('todo lancamento nasce PENDENTE', async () => {
      await service.create(ACTOR, VALID_DTO, null);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: FinancialEntryStatus.Pendente }),
      );
    });

    it('o autor e sempre o usuario autenticado', async () => {
      await service.create(ACTOR, VALID_DTO, null);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ criadoPorId: ACTOR.id }),
      );
    });

    it('observacao ausente vira null, nunca undefined', async () => {
      await service.create(ACTOR, VALID_DTO, null);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ observacao: null }));
    });

    it('audita a criacao com metadados minimos', async () => {
      const { entry: criado } = await service.create(ACTOR, VALID_DTO, '10.0.0.5');

      expect(auditService.record).toHaveBeenCalledWith({
        usuarioId: ACTOR.id,
        acao: AuditAction.FinanceEntryCreated,
        modulo: AuditModuleName.Finance,
        descricao: `Lancamento ${criado.id} por ${ACTOR.email}`,
        ip: '10.0.0.5',
        metadados: { alvoId: criado.id, tipo: criado.tipo, status: criado.status },
      });
    });

    it('nao grava valor nem descricao do lancamento na trilha', async () => {
      await service.create(ACTOR, VALID_DTO, null);

      const registro = JSON.stringify(auditService.record.mock.calls[0]?.[0]?.metadados);
      expect(registro).not.toContain('1500');
      expect(registro).not.toContain('Compra de insumos');
    });
  });

  describe('get', () => {
    it('devolve o lancamento com o autor resolvido', async () => {
      const { entry: encontrado, autor } = await service.get('entry-1');

      expect(encontrado.id).toBe('entry-1');
      expect(autor).toEqual(IDENTIDADE);
    });

    it('lancamento inexistente: NotFoundException', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.get('nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('autor removido do sistema nao quebra a consulta', async () => {
      userDirectory.findByIds.mockResolvedValue(new Map());

      const { autor } = await service.get('entry-1');

      expect(autor).toBeUndefined();
    });
  });

  describe('list', () => {
    it('converte a pagina (1-based) no deslocamento do banco', async () => {
      await service.list(1, 20);
      expect(repository.findPage).toHaveBeenCalledWith(0, 20);

      await service.list(3, 10);
      expect(repository.findPage).toHaveBeenLastCalledWith(20, 10);
    });

    it('devolve os itens e o total vindos do banco', async () => {
      repository.findPage.mockResolvedValue([[entry({ id: 'a' }), entry({ id: 'b' })], 42]);

      const { items, total } = await service.list(1, 20);

      expect(items.map(({ entry: e }) => e.id)).toEqual(['a', 'b']);
      expect(total).toBe(42);
    });

    it('resolve os autores numa UNICA busca, sem N+1', async () => {
      repository.findPage.mockResolvedValue([
        [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c', criadoPorId: 'user-2' })],
        3,
      ]);

      await service.list(1, 20);

      expect(userDirectory.findByIds).toHaveBeenCalledTimes(1);
      expect(userDirectory.findByIds).toHaveBeenCalledWith(['user-1', 'user-1', 'user-2']);
    });

    it('listar nao gera auditoria', async () => {
      await service.list(1, 20);

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('altera os campos enviados', async () => {
      const { entry: salvo } = await service.update(ACTOR, 'entry-1', { descricao: 'Novo' }, null);

      expect(salvo.descricao).toBe('Novo');
      expect(repository.save).toHaveBeenCalled();
    });

    it('audita registrando apenas os NOMES dos campos alterados', async () => {
      await service.update(ACTOR, 'entry-1', { descricao: 'Novo', valor: 99.9 }, null);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: AuditAction.FinanceEntryUpdated,
          metadados: { alvoId: 'entry-1', campos: ['descricao', 'valor'] },
        }),
      );
    });

    it('corpo vazio nao grava nem audita', async () => {
      await service.update(ACTOR, 'entry-1', {}, null);

      expect(repository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('lancamento inexistente: NotFoundException', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(ACTOR, 'nao-existe', { descricao: 'x' }, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update: integridade do fato financeiro', () => {
    /** Nem grava, nem audita - a recusa acontece antes de qualquer efeito. */
    function esperarNenhumEfeito(): void {
      expect(repository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    }

    describe('PENDENTE ainda e uma previsao', () => {
      it.each([
        ['valor', { valor: 99.9 }],
        ['data', { data: '2030-01-01' }],
        ['descricao', { descricao: 'Outra' }],
        ['valor e data juntos', { valor: 1, data: '2030-01-01' }],
      ])('permite alterar %s', async (_nome, alteracao) => {
        repository.findById.mockResolvedValue(entry({ status: FinancialEntryStatus.Pendente }));

        await expect(service.update(ACTOR, 'entry-1', alteracao, null)).resolves.toBeDefined();
        expect(repository.save).toHaveBeenCalled();
      });
    });

    describe('PAGO congela tipo, valor e data', () => {
      let pago: FinancialEntry;

      beforeEach(() => {
        pago = entry({ status: FinancialEntryStatus.Pago });
        repository.findById.mockResolvedValue(pago);
      });

      it.each([
        ['valor', { valor: 99.9 }],
        ['data', { data: '2030-01-01' }],
        ['tipo', { tipo: FinancialEntryType.Receita }],
        ['valor e data juntos', { valor: 1, data: '2030-01-01' }],
        [
          'tipo, valor e data juntos',
          {
            tipo: FinancialEntryType.Receita,
            valor: 1,
            data: '2030-01-01',
          },
        ],
        ['valor junto de um campo permitido', { descricao: 'Nova', valor: 1 }],
        [
          'tipo junto de um campo permitido',
          {
            descricao: 'Nova',
            tipo: FinancialEntryType.Receita,
          },
        ],
      ])('recusa alterar %s com ConflictException', async (_nome, alteracao) => {
        await expect(service.update(ACTOR, 'entry-1', alteracao, null)).rejects.toBeInstanceOf(
          ConflictException,
        );
        esperarNenhumEfeito();
      });

      it('a recusa do tipo nao toca no lancamento carregado', async () => {
        // A checagem vem antes do Object.assign: nada e escrito nem em memoria.
        await expect(
          service.update(ACTOR, 'entry-1', { tipo: FinancialEntryType.Receita }, null),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(pago.tipo).toBe(FinancialEntryType.Despesa);
      });

      it('a mensagem diz quais campos foram recusados', async () => {
        await expect(service.update(ACTOR, 'entry-1', { valor: 1 }, null)).rejects.toThrow(
          /PAGO nao permite alterar: valor/,
        );
        await expect(
          service.update(ACTOR, 'entry-1', { tipo: FinancialEntryType.Receita }, null),
        ).rejects.toThrow(/PAGO nao permite alterar: tipo/);
      });

      it.each([
        ['descricao', { descricao: 'Corrigindo o texto' }],
        ['categoria', { categoria: 'Outra' }],
        ['observacao', { observacao: 'Nota fiscal 123' }],
      ])('permite alterar %s', async (_nome, alteracao) => {
        await expect(service.update(ACTOR, 'entry-1', alteracao, null)).resolves.toBeDefined();
        expect(repository.save).toHaveBeenCalled();
        expect(auditService.record).toHaveBeenCalledWith(
          expect.objectContaining({ acao: AuditAction.FinanceEntryUpdated }),
        );
      });
    });

    describe('CANCELADO esta encerrado', () => {
      beforeEach(() => {
        repository.findById.mockResolvedValue(entry({ status: FinancialEntryStatus.Cancelado }));
      });

      it.each([
        ['valor', { valor: 99.9 }],
        ['data', { data: '2030-01-01' }],
        ['descricao', { descricao: 'Outra' }],
        ['categoria', { categoria: 'Outra' }],
        ['observacao', { observacao: 'Outra' }],
        ['tipo', { tipo: FinancialEntryType.Receita }],
      ])('recusa alterar %s com ConflictException', async (_nome, alteracao) => {
        await expect(service.update(ACTOR, 'entry-1', alteracao, null)).rejects.toBeInstanceOf(
          ConflictException,
        );
        esperarNenhumEfeito();
      });

      it('a mensagem diz que o lancamento nao pode ser alterado', async () => {
        await expect(service.update(ACTOR, 'entry-1', { descricao: 'x' }, null)).rejects.toThrow(
          /CANCELADO nao pode ser alterado/,
        );
      });

      it('corpo vazio continua sem efeito, e nao vira erro', async () => {
        await expect(service.update(ACTOR, 'entry-1', {}, null)).resolves.toBeDefined();
        esperarNenhumEfeito();
      });
    });
  });

  describe('changeStatus', () => {
    it.each([
      [FinancialEntryStatus.Pendente, FinancialEntryStatus.Pago],
      [FinancialEntryStatus.Pendente, FinancialEntryStatus.Cancelado],
      [FinancialEntryStatus.Pago, FinancialEntryStatus.Cancelado],
    ])('permite %s -> %s', async (de, para) => {
      repository.findById.mockResolvedValue(entry({ status: de }));

      const { entry: salvo } = await service.changeStatus(ACTOR, 'entry-1', para, null);

      expect(salvo.status).toBe(para);
    });

    it.each([
      [FinancialEntryStatus.Pago, FinancialEntryStatus.Pendente],
      [FinancialEntryStatus.Cancelado, FinancialEntryStatus.Pago],
      [FinancialEntryStatus.Cancelado, FinancialEntryStatus.Pendente],
    ])('recusa %s -> %s com ConflictException', async (de, para) => {
      repository.findById.mockResolvedValue(entry({ status: de }));

      await expect(service.changeStatus(ACTOR, 'entry-1', para, null)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('repetir o status atual nao grava nem audita', async () => {
      repository.findById.mockResolvedValue(entry({ status: FinancialEntryStatus.Pago }));

      const { entry: salvo } = await service.changeStatus(
        ACTOR,
        'entry-1',
        FinancialEntryStatus.Pago,
        null,
      );

      expect(salvo.status).toBe(FinancialEntryStatus.Pago);
      expect(repository.save).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('audita a transicao com o status anterior e o novo', async () => {
      await service.changeStatus(ACTOR, 'entry-1', FinancialEntryStatus.Pago, null);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: AuditAction.FinanceEntryStatusChanged,
          metadados: { alvoId: 'entry-1', de: 'PENDENTE', para: 'PAGO' },
        }),
      );
    });

    it('lancamento inexistente: NotFoundException', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.changeStatus(ACTOR, 'nao-existe', FinancialEntryStatus.Pago, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('auditoria best-effort', () => {
    /**
     * Usa o `AuditService` REAL com um repositorio que falha, e nao um mock que
     * rejeita: a politica best-effort e do proprio AuditService (ele captura e
     * loga), exatamente como no modulo de usuarios. Testar com o servico real
     * verifica a garantia de verdade, em vez de uma suposicao sobre o mock.
     */
    let comAuditoriaQuebrada: FinanceService;

    beforeEach(() => {
      const auditRepository = {
        create: jest.fn().mockRejectedValue(new Error('banco de auditoria indisponivel')),
      };
      const real = new AuditService(
        auditRepository as unknown as AuditRepository,
        userDirectory as unknown as UserDirectoryService,
      );
      jest.spyOn(real['logger'], 'error').mockImplementation(() => undefined);

      comAuditoriaQuebrada = new FinanceService(
        repository as unknown as FinanceRepository,
        userDirectory as unknown as UserDirectoryService,
        real,
      );
    });

    it.each([
      ['create', (s: FinanceService) => s.create(ACTOR, VALID_DTO, null)],
      ['update', (s: FinanceService) => s.update(ACTOR, 'entry-1', { descricao: 'x' }, null)],
      [
        'changeStatus',
        (s: FinanceService) => s.changeStatus(ACTOR, 'entry-1', FinancialEntryStatus.Pago, null),
      ],
    ])('falha ao gravar a auditoria nao derruba %s', async (_nome, operacao) => {
      await expect(operacao(comAuditoriaQuebrada)).resolves.toBeDefined();
      // A alteracao foi efetivada mesmo sem o registro na trilha.
      expect(repository.create.mock.calls.length + repository.save.mock.calls.length).toBe(1);
    });
  });

  describe('overview', () => {
    it('pede o total e apenas os mais recentes', async () => {
      repository.count.mockResolvedValue(7);
      repository.findLatest.mockResolvedValue([entry()]);

      const resumo = await service.overview();

      expect(repository.findLatest).toHaveBeenCalledWith(OVERVIEW_LIMIT);
      expect(resumo.total).toBe(7);
      expect(resumo.recentes).toHaveLength(1);
    });

    it('banco vazio devolve total zero e nenhum lancamento', async () => {
      const resumo = await service.overview();

      expect(resumo).toEqual({ total: 0, recentes: [] });
    });
  });
});
