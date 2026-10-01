import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Writable } from 'node:stream';
import { stream as excelStream } from 'exceljs';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { FinanceReportSummaryDto, toReportFilters } from './dto/finance-report-response.dto';
import type { FinanceFilter } from './finance-filter';
import { FinanceRepository, type EntryCursor } from './finance.repository';
import { FinancialEntryStatus, FinancialEntryType } from './financial-entry.enums';
import { checkReportPeriod } from './report-period.policy';

/** Recorte de relatorio: o periodo e obrigatorio. */
export type ReportFilter = FinanceFilter & { de: string; ate: string };

/** Teto de linhas de uma exportacao. Acima disso o pedido e recusado. */
export const EXPORT_MAX_ROWS = 50_000;

/** Lancamentos lidos por vez na exportacao. Mantem a memoria limitada. */
const EXPORT_BATCH_SIZE = 500;

/** Dia 0 do calendario do Excel: 30/12/1899. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Relatorios do financeiro: resumo agregado e exportacao XLSX.
 *
 * Usa os MESMOS filtros da listagem (`FinanceFilter`) e o mesmo repositorio -
 * nao ha segunda forma de consultar lancamentos.
 *
 * Toda soma e feita no banco (`COUNT`, `SUM`, `GROUP BY`). O Node nunca percorre
 * lancamentos para somar dinheiro, nem no resumo nem na exportacao.
 *
 * AUDITORIA: consultar nao entra na trilha - mesmo criterio que tirou o
 * `FINANCE_QUERIED` do financeiro. A EXPORTACAO entra: ela produz um arquivo que
 * sai do sistema, e "quem extraiu a base" e justamente o que a trilha deve
 * responder. Os metadados levam so o recorte e a contagem de linhas; nenhum
 * valor monetario, nenhuma descricao, nenhum conteudo da planilha.
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Resumo do conjunto filtrado.
   *
   * @throws BadRequestException periodo invalido (`ate` antes de `de`, ou acima
   *   do maximo permitido).
   */
  async summary(filter: ReportFilter): Promise<FinanceReportSummaryDto> {
    this.requireValidPeriod(filter);

    // Quatro consultas agregadas, nenhuma linha carregada.
    const [totais, porStatus, porTipo, porCategoria] = await Promise.all([
      this.repository.totals(filter),
      this.repository.groupedTotals<FinancialEntryStatus>(filter, 'status'),
      this.repository.groupedTotals<FinancialEntryType>(filter, 'tipo'),
      this.repository.groupedTotals<string>(filter, 'categoria'),
    ]);

    return {
      filtros: toReportFilters(filter),
      ...totais,
      porStatus: porStatus.map(({ key, quantidade, valor }) => ({
        status: key,
        quantidade,
        valor,
      })),
      porTipo: porTipo.map(({ key, quantidade, valor }) => ({ tipo: key, quantidade, valor })),
      porCategoria: porCategoria.map(({ key, quantidade, valor }) => ({
        categoria: key,
        quantidade,
        valor,
      })),
    };
  }

  /** Nome do arquivo. Leva so o periodo - nenhum dado do cliente. */
  exportFileName(filter: ReportFilter): string {
    return `vastaflow-financeiro-${filter.de}-a-${filter.ate}.xlsx`;
  }

  /**
   * Escreve a planilha dos lancamentos filtrados.
   *
   * A planilha traz as LINHAS do recorte, nao o resumo. E escrita em modo
   * streaming (`WorkbookWriter`): as linhas vao para o stream em lotes e a
   * planilha inteira nunca fica na memoria.
   *
   * O destino vem como FUNCAO, e nao como stream pronto, de proposito: `open` so
   * e chamado depois de o periodo ser aceito e o volume conferido. E o que
   * garante que um 400/409 saia como resposta de erro normal - se o cabecalho de
   * download fosse escrito antes da checagem, o cliente receberia um `.xlsx`
   * corrompido no lugar da mensagem de erro.
   *
   * @throws BadRequestException periodo invalido.
   * @throws ConflictException recorte acima de `EXPORT_MAX_ROWS` linhas.
   * @returns quantas linhas foram escritas.
   */
  async exportToStream(
    actor: AuthenticatedUser,
    filter: ReportFilter,
    ip: string | null,
    open: () => Writable,
  ): Promise<number> {
    this.requireValidPeriod(filter);

    const total = await this.repository.countFiltered(filter);
    if (total > EXPORT_MAX_ROWS) {
      throw new ConflictException(
        `A exportacao esta limitada a ${EXPORT_MAX_ROWS} lancamentos e o filtro atual tem ${total}. ` +
          'Reduza o periodo ou use mais filtros.',
      );
    }

    const escritas = await this.writeWorkbook(filter, open());

    await this.auditService.record({
      usuarioId: actor.id,
      acao: AuditAction.FinanceReportExported,
      modulo: AuditModuleName.Finance,
      descricao: `Relatorio financeiro exportado por ${actor.email}`,
      ip,
      // Somente o recorte e o volume. Nenhum valor, nenhuma descricao de
      // lancamento, nada do conteudo do arquivo.
      metadados: {
        de: filter.de,
        ate: filter.ate,
        status: filter.status ?? null,
        tipo: filter.tipo ?? null,
        categoria: filter.categoria ?? null,
        quantidade: escritas,
      },
    });

    return escritas;
  }

  private requireValidPeriod(filter: ReportFilter): void {
    const periodo = checkReportPeriod(filter.de, filter.ate);
    if (!periodo.ok) {
      throw new BadRequestException(periodo.erro);
    }
  }

  /** Monta e commita a planilha, lendo os lancamentos em lotes por cursor. */
  private async writeWorkbook(filter: ReportFilter, destino: Writable): Promise<number> {
    const workbook = new excelStream.xlsx.WorkbookWriter({
      stream: destino,
      useStyles: true,
    });
    const sheet = workbook.addWorksheet('Lancamentos', {
      // Cabecalho sempre visivel ao rolar; compativel com o modo streaming.
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Descricao', key: 'descricao', width: 40 },
      { header: 'Valor', key: 'valor', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Data', key: 'data', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Categoria', key: 'categoria', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Observacao', key: 'observacao', width: 40 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();

    let escritas = 0;
    let cursor: EntryCursor | undefined;

    for (;;) {
      const lote = await this.repository.findBatch(filter, EXPORT_BATCH_SIZE, cursor);
      if (lote.length === 0) {
        break;
      }

      for (const entry of lote) {
        sheet
          .addRow({
            id: entry.id,
            tipo: entry.tipo,
            descricao: entry.descricao,
            valor: entry.valor,
            data: toExcelDate(entry.data),
            categoria: entry.categoria,
            status: entry.status,
            observacao: entry.observacao ?? '',
          })
          .commit();
        escritas += 1;
      }

      const ultimo = lote[lote.length - 1];
      cursor = { data: ultimo.data, id: ultimo.id };
      if (lote.length < EXPORT_BATCH_SIZE) {
        break;
      }
    }

    sheet.commit();
    await workbook.commit();
    return escritas;
  }
}

/**
 * Converte `YYYY-MM-DD` no numero de serie de data do Excel.
 *
 * Aritmetica inteira em UTC, de proposito: passar a string por `new Date()` e
 * deixar a biblioteca converter arrisca o dia voltar um em fuso negativo - o
 * mesmo erro que a coluna `data` ja evita com `utc: true`. Gravar um numero com
 * formato de data mantem a celula ordenavel e filtravel como data no Excel, o
 * que um texto nao seria.
 */
function toExcelDate(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number);
  return (Date.UTC(ano, mes - 1, dia) - EXCEL_EPOCH_MS) / MS_PER_DAY;
}
