import { BadRequestException, ConflictException } from '@nestjs/common';
import { PassThrough, Writable } from 'node:stream';
import { Workbook } from 'exceljs';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoleName } from '../roles/role-name.enum';
import type { FinancialEntry } from './entities/financial-entry.entity';
import {
  EXPORT_MAX_ROWS,
  FinanceReportsService,
  type ReportFilter,
} from './finance-reports.service';
import type { FinanceRepository } from './finance.repository';
import { FinancialEntryStatus, FinancialEntryType } from './financial-entry.enums';

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

const PERIODO: ReportFilter = { de: '2026-01-01', ate: '2026-01-31' };

function entry(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: 'entry-1',
    tipo: FinancialEntryType.Despesa,
    descricao: 'Compra de insumos',
    valor: 1500.5,
    data: '2026-01-10',
    categoria: 'Insumos',
    status: FinancialEntryStatus.Pendente,
    observacao: null,
    criadoPorId: ACTOR.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Junta o que foi escrito no stream, para abrir a planilha de volta. */
function coletor(): { stream: Writable; buffer: () => Promise<Buffer> } {
  const stream = new PassThrough();
  const pedacos: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
    stream.on('end', () => resolve(Buffer.concat(pedacos)));
    stream.on('error', reject);
  });
  return { stream, buffer: () => pronto };
}

/**
 * Copia os bytes para um `ArrayBuffer` do tamanho exato.
 *
 * `Xlsx.load` pede um `ArrayBuffer`: o `index.d.ts` do exceljs declara
 * `interface Buffer extends ArrayBuffer`, e nao o `Buffer` do Node.
 */
function paraArrayBuffer(bytes: Buffer): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('FinanceReportsService', () => {
  type RepositoryMock = jest.Mocked<
    Pick<FinanceRepository, 'totals' | 'groupedTotals' | 'countFiltered' | 'findBatch'>
  >;

  let repository: RepositoryMock;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: FinanceReportsService;

  beforeEach(() => {
    repository = {
      totals: jest.fn().mockResolvedValue({
        totalRegistros: 3,
        totalReceitas: 1000,
        totalDespesas: 400.25,
        saldo: 599.75,
      }),
      groupedTotals: jest.fn().mockResolvedValue([]),
      countFiltered: jest.fn().mockResolvedValue(2),
      findBatch: jest.fn().mockResolvedValue([]),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new FinanceReportsService(
      repository as unknown as FinanceRepository,
      auditService as unknown as AuditService,
    );
  });

  describe('summary', () => {
    it('monta a resposta a partir da agregacao do banco', async () => {
      repository.groupedTotals.mockImplementation((_filter, column) => {
        if (column === 'status') {
          return Promise.resolve([
            { key: FinancialEntryStatus.Cancelado, quantidade: 1, valor: 99 },
            { key: FinancialEntryStatus.Pago, quantidade: 2, valor: 1400.25 },
          ]);
        }
        if (column === 'tipo') {
          return Promise.resolve([{ key: FinancialEntryType.Receita, quantidade: 1, valor: 1000 }]);
        }
        return Promise.resolve([{ key: 'Insumos', quantidade: 2, valor: 400.25 }]);
      });

      const resumo = await service.summary({
        ...PERIODO,
        status: FinancialEntryStatus.Pago,
        tipo: FinancialEntryType.Despesa,
        categoria: 'Insumos',
      });

      expect(resumo.totalRegistros).toBe(3);
      expect(resumo.totalReceitas).toBe(1000);
      expect(resumo.totalDespesas).toBe(400.25);
      expect(resumo.saldo).toBe(599.75);
      expect(resumo.porStatus).toEqual([
        { status: FinancialEntryStatus.Cancelado, quantidade: 1, valor: 99 },
        { status: FinancialEntryStatus.Pago, quantidade: 2, valor: 1400.25 },
      ]);
      expect(resumo.porTipo).toEqual([
        { tipo: FinancialEntryType.Receita, quantidade: 1, valor: 1000 },
      ]);
      expect(resumo.porCategoria).toEqual([{ categoria: 'Insumos', quantidade: 2, valor: 400.25 }]);
    });

    it('devolve o recorte aplicado, com os filtros ausentes como null', async () => {
      const resumo = await service.summary(PERIODO);

      expect(resumo.filtros).toEqual({
        de: '2026-01-01',
        ate: '2026-01-31',
        status: null,
        tipo: null,
        categoria: null,
      });
    });

    it('nao expoe um valorTotal somando receitas com despesas', async () => {
      // Somar receita com despesa produziria um numero sem significado: o sinal
      // esta no `tipo`. Quem representa dinheiro liquido e o `saldo`.
      const resumo = await service.summary(PERIODO);

      expect(resumo).not.toHaveProperty('valorTotal');
    });

    it('repassa o MESMO recorte as quatro consultas', async () => {
      const filtro: ReportFilter = { ...PERIODO, tipo: FinancialEntryType.Receita };

      await service.summary(filtro);

      expect(repository.totals).toHaveBeenCalledWith(filtro);
      expect(repository.groupedTotals).toHaveBeenCalledWith(filtro, 'status');
      expect(repository.groupedTotals).toHaveBeenCalledWith(filtro, 'tipo');
      expect(repository.groupedTotals).toHaveBeenCalledWith(filtro, 'categoria');
    });

    it('nao carrega lancamento nenhum para somar', async () => {
      await service.summary(PERIODO);

      // Toda soma sai do banco; nenhuma linha passa pelo Node.
      expect(repository.findBatch).not.toHaveBeenCalled();
    });

    it('consultar o resumo nao gera auditoria', async () => {
      await service.summary(PERIODO);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it.each([
      ['ate anterior a de', { de: '2026-02-01', ate: '2026-01-01' }],
      ['periodo acima do maximo', { de: '2020-01-01', ate: '2026-12-31' }],
      ['data inexistente', { de: '2026-01-01', ate: '2026-02-30' }],
    ])('recusa %s com 400, sem consultar o banco', async (_caso, periodo) => {
      await expect(service.summary(periodo)).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.totals).not.toHaveBeenCalled();
      expect(repository.groupedTotals).not.toHaveBeenCalled();
    });
  });

  describe('exportToStream', () => {
    it('escreve uma planilha legivel, com cabecalho e uma linha por lancamento', async () => {
      repository.findBatch.mockResolvedValueOnce([
        entry({ id: 'a', data: '2026-01-10', valor: 1500.5 }),
        entry({
          id: 'b',
          data: '2026-01-02',
          valor: 0.01,
          tipo: FinancialEntryType.Receita,
          status: FinancialEntryStatus.Pago,
          descricao: 'Venda',
          categoria: 'Vendas',
          observacao: 'parcial',
        }),
      ]);
      const destino = coletor();

      const escritas = await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

      expect(escritas).toBe(2);

      const workbook = new Workbook();
      await workbook.xlsx.load(paraArrayBuffer(await destino.buffer()));
      const sheet = workbook.getWorksheet('Lancamentos');
      expect(sheet).toBeDefined();
      expect(sheet?.rowCount).toBe(3); // cabecalho + 2 lancamentos
      expect(sheet?.getRow(1).values).toEqual([
        undefined,
        'ID',
        'Tipo',
        'Descricao',
        'Valor',
        'Data',
        'Categoria',
        'Status',
        'Observacao',
      ]);

      const primeira = sheet?.getRow(2);
      expect(primeira?.getCell(1).value).toBe('a');
      expect(primeira?.getCell(2).value).toBe(FinancialEntryType.Despesa);
      expect(primeira?.getCell(3).value).toBe('Compra de insumos');
      // Dinheiro vai como NUMERO, nao como texto: o Excel precisa poder somar.
      expect(primeira?.getCell(4).value).toBe(1500.5);
      expect(typeof primeira?.getCell(4).value).toBe('number');

      const segunda = sheet?.getRow(3);
      expect(segunda?.getCell(4).value).toBe(0.01);
      expect(segunda?.getCell(8).value).toBe('parcial');
    });

    it('grava a data como data, sem deslocar o dia', async () => {
      repository.findBatch.mockResolvedValueOnce([
        entry({ id: 'a', data: '2026-01-01' }),
        entry({ id: 'b', data: '2024-02-29' }),
        entry({ id: 'c', data: '2026-12-31' }),
      ]);
      const destino = coletor();

      await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

      const workbook = new Workbook();
      await workbook.xlsx.load(paraArrayBuffer(await destino.buffer()));
      const sheet = workbook.getWorksheet('Lancamentos');

      // Comparar o instante COMPLETO, e nao so o trecho do dia: a celula tem de
      // ser meia-noite UTC exata. Converter via fuso local produziria o mesmo dia
      // com hora deslocada em maquinas a oeste de UTC - e o dia errado a leste -,
      // entao conferir apenas `slice(0, 10)` deixaria o erro passar aqui e falhar
      // na maquina de outra pessoa.
      const instantes = [2, 3, 4].map((linha) => {
        const valor = sheet?.getRow(linha).getCell(5).value;
        return valor instanceof Date ? valor.toISOString() : valor;
      });
      expect(instantes).toEqual([
        '2026-01-01T00:00:00.000Z',
        '2024-02-29T00:00:00.000Z',
        '2026-12-31T00:00:00.000Z',
      ]);
    });

    it('nao transforma texto do usuario em formula', async () => {
      // Uma descricao comecando com `=` tem de continuar sendo texto inerte na
      // planilha, e nao uma formula que o Excel executaria ao abrir.
      repository.findBatch.mockResolvedValueOnce([
        entry({ id: 'a', descricao: '=HYPERLINK("http://x","clique")', observacao: '-1+1' }),
      ]);
      const destino = coletor();

      await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

      const workbook = new Workbook();
      await workbook.xlsx.load(paraArrayBuffer(await destino.buffer()));
      const linha = workbook.getWorksheet('Lancamentos')?.getRow(2);

      expect(linha?.getCell(3).value).toBe('=HYPERLINK("http://x","clique")');
      expect(linha?.getCell(3).formula).toBeUndefined();
      expect(linha?.getCell(8).value).toBe('-1+1');
      expect(linha?.getCell(8).formula).toBeUndefined();
    });

    it('le em lotes por cursor, continuando de onde parou', async () => {
      const primeiroLote = Array.from({ length: 500 }, (_, i) =>
        entry({ id: `a${i}`, data: '2026-01-20' }),
      );
      repository.findBatch
        .mockResolvedValueOnce(primeiroLote)
        .mockResolvedValueOnce([entry({ id: 'z', data: '2026-01-05' })]);
      const destino = coletor();

      const escritas = await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

      expect(escritas).toBe(501);
      expect(repository.findBatch).toHaveBeenCalledTimes(2);
      // Primeiro lote sem cursor; o segundo continua da ultima linha lida.
      expect(repository.findBatch).toHaveBeenNthCalledWith(1, PERIODO, 500, undefined);
      expect(repository.findBatch).toHaveBeenNthCalledWith(2, PERIODO, 500, {
        data: '2026-01-20',
        id: 'a499',
      });
    });

    it('para de ler quando o lote vem incompleto', async () => {
      repository.findBatch.mockResolvedValueOnce([entry()]);
      const destino = coletor();

      await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

      // Lote menor que o tamanho pedido significa fim do conjunto: nao faz
      // sentido uma consulta a mais so para receber vazio.
      expect(repository.findBatch).toHaveBeenCalledTimes(1);
    });

    it('recusa com 409 acima do limite de linhas e NAO abre o stream', async () => {
      repository.countFiltered.mockResolvedValue(EXPORT_MAX_ROWS + 1);
      const abrir = jest.fn<Writable, []>();

      await expect(service.exportToStream(ACTOR, PERIODO, null, abrir)).rejects.toBeInstanceOf(
        ConflictException,
      );

      // O ponto central: nada foi escrito na resposta, entao o 409 ainda sai como
      // JSON de erro em vez de um arquivo corrompido.
      expect(abrir).not.toHaveBeenCalled();
      expect(repository.findBatch).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('a mensagem do 409 diz o limite e o tamanho do recorte', async () => {
      repository.countFiltered.mockResolvedValue(73_000);
      const abrir = jest.fn<Writable, []>();

      await expect(service.exportToStream(ACTOR, PERIODO, null, abrir)).rejects.toThrow(
        /50000.*73000/,
      );
    });

    it('aceita exatamente o limite de linhas', async () => {
      repository.countFiltered.mockResolvedValue(EXPORT_MAX_ROWS);
      repository.findBatch.mockResolvedValueOnce([entry()]);
      const destino = coletor();

      await expect(
        service.exportToStream(ACTOR, PERIODO, null, () => destino.stream),
      ).resolves.toBe(1);
    });

    it('recusa periodo invalido antes de contar e antes de abrir o stream', async () => {
      const abrir = jest.fn<Writable, []>();

      await expect(
        service.exportToStream(ACTOR, { de: '2026-02-01', ate: '2026-01-01' }, null, abrir),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.countFiltered).not.toHaveBeenCalled();
      expect(abrir).not.toHaveBeenCalled();
    });

    it('exporta um recorte vazio como planilha so com cabecalho', async () => {
      repository.countFiltered.mockResolvedValue(0);
      repository.findBatch.mockResolvedValue([]);
      const destino = coletor();

      const escritas = await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

      expect(escritas).toBe(0);
      const workbook = new Workbook();
      await workbook.xlsx.load(paraArrayBuffer(await destino.buffer()));
      expect(workbook.getWorksheet('Lancamentos')?.rowCount).toBe(1);
    });

    describe('auditoria', () => {
      it('registra a exportacao com o recorte e a quantidade de linhas', async () => {
        repository.findBatch.mockResolvedValueOnce([entry({ id: 'a' }), entry({ id: 'b' })]);
        const destino = coletor();
        const filtro: ReportFilter = {
          ...PERIODO,
          status: FinancialEntryStatus.Pago,
          tipo: FinancialEntryType.Despesa,
          categoria: 'Insumos',
        };

        await service.exportToStream(ACTOR, filtro, '203.0.113.7', () => destino.stream);

        expect(auditService.record).toHaveBeenCalledTimes(1);
        expect(auditService.record).toHaveBeenCalledWith({
          usuarioId: ACTOR.id,
          acao: AuditAction.FinanceReportExported,
          modulo: AuditModuleName.Finance,
          descricao: 'Relatorio financeiro exportado por maria@example.com',
          ip: '203.0.113.7',
          metadados: {
            de: '2026-01-01',
            ate: '2026-01-31',
            status: FinancialEntryStatus.Pago,
            tipo: FinancialEntryType.Despesa,
            categoria: 'Insumos',
            quantidade: 2,
          },
        });
      });

      it('filtro ausente entra como null, nunca omitido', async () => {
        const destino = coletor();

        await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

        const [[registro]] = auditService.record.mock.calls;
        expect(registro.metadados).toEqual({
          de: '2026-01-01',
          ate: '2026-01-31',
          status: null,
          tipo: null,
          categoria: null,
          quantidade: 0,
        });
      });

      it('nao registra valor monetario nem conteudo dos lancamentos', async () => {
        repository.findBatch.mockResolvedValueOnce([
          entry({ descricao: 'Pagamento sigiloso', valor: 98_765.43, observacao: 'confidencial' }),
        ]);
        const destino = coletor();

        await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

        const [[registro]] = auditService.record.mock.calls;
        const serializado = JSON.stringify(registro);
        expect(serializado).not.toContain('Pagamento sigiloso');
        expect(serializado).not.toContain('confidencial');
        expect(serializado).not.toContain('98765.43');
        expect(serializado).not.toContain('98,765.43');
      });

      it('audita o numero de linhas realmente escritas', async () => {
        // `countFiltered` e a checagem do limite; quem vai para a trilha e o que
        // de fato entrou no arquivo.
        repository.countFiltered.mockResolvedValue(900);
        repository.findBatch.mockResolvedValueOnce([entry({ id: 'a' })]);
        const destino = coletor();

        await service.exportToStream(ACTOR, PERIODO, null, () => destino.stream);

        const [[registro]] = auditService.record.mock.calls;
        expect(registro.metadados).toMatchObject({ quantidade: 1 });
      });
    });
  });

  describe('exportFileName', () => {
    it('leva so o periodo, e termina em .xlsx', () => {
      expect(service.exportFileName(PERIODO)).toBe(
        'vastaflow-financeiro-2026-01-01-a-2026-01-31.xlsx',
      );
    });

    it('nao leva categoria nem qualquer dado de negocio no nome do arquivo', () => {
      const nome = service.exportFileName({ ...PERIODO, categoria: 'Folha de pagamento' });

      expect(nome).not.toContain('Folha');
    });
  });
});
