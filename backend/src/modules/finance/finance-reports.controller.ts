import { Controller, Get, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionCode } from '../permissions/permission-code.enum';
import { ReportFilterQuery } from './dto/finance-filter.query';
import { FinanceReportSummaryDto } from './dto/finance-report-response.dto';
import { toFinanceFilter } from './finance-filter';
import {
  EXPORT_MAX_ROWS,
  FinanceReportsService,
  type ReportFilter,
} from './finance-reports.service';
import { MAX_REPORT_PERIOD_DAYS } from './report-period.policy';

/** Tipo MIME de uma planilha XLSX. */
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Relatorios do financeiro.
 *
 * Controller separado do de lancamentos porque o recurso e outro: aqui nada e
 * criado nem alterado, so lido em forma agregada ou exportado.
 *
 * PERMISSAO: `finance:read`, a mesma da listagem - e deliberado. O relatorio e o
 * mesmo conjunto de lancamentos que quem tem `finance:read` ja pode percorrer
 * pagina por pagina; uma permissao nova sugeriria uma barreira que nao existe de
 * fato. O que diferencia a exportacao e a trilha de auditoria, nao o acesso.
 */
@ApiTags('Finance')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@ApiForbiddenResponse({ description: 'Perfil sem a permissao necessaria' })
@Controller('finance/reports')
export class FinanceReportsController {
  constructor(private readonly reportsService: FinanceReportsService) {}

  @Get('summary')
  @RequirePermissions(PermissionCode.FinanceRead)
  @ApiOperation({
    summary: 'Resumo financeiro do periodo',
    description:
      'Exige `finance:read`. `de` e `ate` sao OBRIGATORIOS (maximo de ' +
      `${MAX_REPORT_PERIOD_DAYS} dias). Os demais filtros sao os mesmos da listagem. ` +
      'Todos os totais vem de agregacao no banco. `saldo` = receitas - despesas, ambas ' +
      'desconsiderando os CANCELADOS; os CANCELADOS seguem contando em `totalRegistros` e ' +
      'aparecendo em `porStatus`. Consultar o resumo nao gera registro de auditoria.',
  })
  @ApiOkResponse({ type: FinanceReportSummaryDto })
  @ApiBadRequestResponse({
    description: 'Periodo ausente, mal formado, invertido ou maior que o maximo permitido',
  })
  summary(@Query() query: ReportFilterQuery): Promise<FinanceReportSummaryDto> {
    return this.reportsService.summary(toReportFilter(query));
  }

  @Get('export')
  @RequirePermissions(PermissionCode.FinanceRead)
  @ApiOperation({
    summary: 'Exporta os lancamentos do periodo em XLSX',
    description:
      'Exige `finance:read`. Mesmos filtros do resumo. Devolve a PLANILHA DOS LANCAMENTOS do ' +
      `recorte (nao o resumo), ate ${EXPORT_MAX_ROWS} linhas - acima disso responde 409. ` +
      'Diferente das consultas, a exportacao E auditada (`FINANCE_REPORT_EXPORTED`).',
  })
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({
    description: 'Planilha XLSX como anexo',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({
    description: 'Periodo ausente, mal formado, invertido ou maior que o maximo permitido',
  })
  @ApiConflictResponse({ description: 'Recorte excede o limite de linhas da exportacao' })
  async export(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ReportFilterQuery,
    @ClientIp() ip: string | null,
    @Res() res: Response,
  ): Promise<void> {
    const filter = toReportFilter(query);

    await this.reportsService.exportToStream(actor, filter, ip, () => {
      // Chamado pelo service SO depois de o periodo e o volume passarem. Antes
      // disso nenhum cabecalho e escrito, entao um 400/409 ainda sai como JSON
      // de erro pelo filtro global.
      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${this.reportsService.exportFileName(filter)}"`,
      );
      // Sem `Content-Length`: o tamanho da planilha so seria conhecido depois de
      // monta-la inteira, que e exatamente o que o streaming evita.
      return res;
    });
    // O proprio `WorkbookWriter` encerra o stream ao finalizar o arquivo.
  }
}

/**
 * Recorte de relatorio a partir da query.
 *
 * `de` e `ate` sao obrigatorios no DTO, entao o tipo os reafirma como `string` -
 * as regras que dependem das duas datas juntas ficam no service.
 */
function toReportFilter(query: ReportFilterQuery): ReportFilter {
  return { ...toFinanceFilter(query), de: query.de, ate: query.ate };
}
