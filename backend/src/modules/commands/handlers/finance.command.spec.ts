import type { FinancialEntry } from '../../finance/entities/financial-entry.entity';
import { FinancialEntryStatus, FinancialEntryType } from '../../finance/financial-entry.enums';
import type { FinanceService } from '../../finance/finance.service';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { CommandOutcome, type CommandHandler } from '../command.types';
import { FinanceCommandHandler, formatDate, formatMoney } from './finance.command';

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
    criadoPorId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('FinanceCommandHandler', () => {
  let financeService: jest.Mocked<Pick<FinanceService, 'overview'>>;
  let handler: FinanceCommandHandler;

  beforeEach(() => {
    financeService = { overview: jest.fn().mockResolvedValue({ total: 0, recentes: [] }) };
    handler = new FinanceCommandHandler(financeService as unknown as FinanceService);
  });

  describe('declaracao do comando', () => {
    it('atende por /financeiro', () => {
      expect(handler.name).toBe('financeiro');
      expect(handler.description).not.toBe('');
    });

    it('exige finance:read - a mesma permissao de quem lista pela API', () => {
      expect(handler.permission).toBe(PermissionCode.FinanceRead);
    });

    it('NAO declara auditoria: consulta nao entra na trilha', () => {
      // A auditoria do motor e opt-in. Este comando so le, entao fica de fora -
      // a trilha registra o que muda, nao o que e consultado.
      // Tipado pela interface: e la que o campo opcional `audit` existe.
      const contrato: CommandHandler = handler;
      expect(contrato.audit).toBeUndefined();
    });

    it('depende do FinanceService, nunca de um repositorio', () => {
      // O handler recebe exatamente um colaborador: o service.
      expect(FinanceCommandHandler.length).toBe(1);
      expect(Object.values(handler)).not.toContainEqual(
        expect.objectContaining({ findPage: expect.anything() as unknown }),
      );
    });
  });

  describe('resposta', () => {
    it('banco sem lancamentos: diz exatamente isso, sem inventar numeros', async () => {
      const resultado = await handler.handle();

      expect(resultado.success).toBe(true);
      expect(resultado.outcome).toBe(CommandOutcome.Ok);
      expect(resultado.reply).toContain('Nenhum lancamento financeiro registrado ainda');
      expect(resultado.reply).not.toMatch(/R\$/);
    });

    it('com lancamentos: mostra o total e os mais recentes, com dados reais', async () => {
      financeService.overview.mockResolvedValue({
        total: 7,
        recentes: [
          entry({ id: 'a', tipo: FinancialEntryType.Receita, valor: 2500, data: '2026-09-22' }),
          entry({ id: 'b', descricao: 'Diesel', valor: 899.9, status: FinancialEntryStatus.Pago }),
        ],
      });

      const { reply } = await handler.handle();

      expect(reply).toContain('Lancamentos registrados: 7');
      expect(reply).toContain('Mais recentes (2)');
      expect(reply).toContain('22/09/2026 RECEITA R$ 2500,00');
      expect(reply).toContain('Diesel');
      expect(reply).toContain('R$ 899,90');
      expect(reply).toContain('(PAGO)');
    });

    it('le do service uma unica vez por execucao', async () => {
      await handler.handle();

      expect(financeService.overview).toHaveBeenCalledTimes(1);
    });
  });

  describe('formatacao', () => {
    it('valores em reais, com virgula decimal e duas casas', () => {
      expect(formatMoney(1500.5)).toBe('R$ 1500,50');
      expect(formatMoney(0.01)).toBe('R$ 0,01');
      expect(formatMoney(2500)).toBe('R$ 2500,00');
    });

    it('datas em dd/mm/aaaa, sem depender do fuso do servidor', () => {
      expect(formatDate('2026-09-23')).toBe('23/09/2026');
      expect(formatDate('2026-01-01')).toBe('01/01/2026');
    });
  });
});
