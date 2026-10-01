import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionCode } from '../permissions/permission-code.enum';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { FinancialEntryPageResponseDto } from './dto/financial-entry-page-response.dto';
import {
  toFinancialEntryResponse,
  FinancialEntryResponseDto,
} from './dto/financial-entry-response.dto';
import { DEFAULT_PAGE_SIZE, ListEntriesQuery } from './dto/list-entries.query';
import { UpdateEntryStatusDto } from './dto/update-entry-status.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { toFinanceFilter } from './finance-filter';
import { FinanceService } from './finance.service';

/**
 * Lancamentos financeiros. Nenhuma rota e publica: todas exigem JWT (guard
 * global) e uma permissao granular do dominio financeiro.
 *
 * O autor do lancamento vem sempre do usuario autenticado - nenhum campo de
 * identificacao de usuario e aceito no corpo.
 */
@ApiTags('Finance')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@ApiForbiddenResponse({ description: 'Perfil sem a permissao necessaria' })
@Controller('finance/entries')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get()
  @RequirePermissions(PermissionCode.FinanceRead)
  @ApiOperation({
    summary: 'Lista os lancamentos, paginado e filtrado',
    description:
      'Exige `finance:read`. Ordenado por data decrescente; o id desempata. Os filtros ' +
      '(`de`, `ate`, `status`, `tipo`, `categoria`) sao todos opcionais e sao os MESMOS dos ' +
      'relatorios. O periodo compara a data do lancamento, inclusiva nas duas pontas. Sem ' +
      'nenhum filtro, lista tudo - como antes dos filtros existirem.',
  })
  @ApiOkResponse({ type: FinancialEntryPageResponseDto })
  @ApiBadRequestResponse({ description: 'Parametros de paginacao ou de filtro invalidos' })
  async findPage(@Query() query: ListEntriesQuery): Promise<FinancialEntryPageResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    // `total` passa a ser o total do conjunto FILTRADO, nao da tabela: e o que
    // faz a paginacao fechar com o que foi pedido.
    const { items, total } = await this.financeService.list(toFinanceFilter(query), page, limit);

    return {
      items: items.map(({ entry, autor }) => toFinancialEntryResponse(entry, autor)),
      total,
      page,
      limit,
    };
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.FinanceRead)
  @ApiOperation({ summary: 'Consulta um lancamento', description: 'Exige `finance:read`.' })
  @ApiOkResponse({ type: FinancialEntryResponseDto })
  @ApiBadRequestResponse({ description: 'Id nao e um UUID' })
  @ApiNotFoundResponse({ description: 'Lancamento nao encontrado' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<FinancialEntryResponseDto> {
    const { entry, autor } = await this.financeService.get(id);
    return toFinancialEntryResponse(entry, autor);
  }

  @Post()
  @RequirePermissions(PermissionCode.FinanceCreate)
  @ApiOperation({
    summary: 'Cria um lancamento',
    description:
      'Exige `finance:create`. O lancamento nasce PENDENTE e o autor e o usuario autenticado.',
  })
  @ApiCreatedResponse({ type: FinancialEntryResponseDto })
  @ApiBadRequestResponse({ description: 'Dados invalidos (valor, data, descricao, categoria)' })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateFinancialEntryDto,
    @ClientIp() ip: string | null,
  ): Promise<FinancialEntryResponseDto> {
    const { entry, autor } = await this.financeService.create(actor, dto, ip);
    return toFinancialEntryResponse(entry, autor);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.FinanceUpdate)
  @ApiOperation({
    summary: 'Edita um lancamento',
    description:
      'Exige `finance:update`. Nao altera status (rota propria) nem o autor - os dois sao ' +
      'recusados com 400 por serem campos fora do DTO.',
  })
  @ApiOkResponse({ type: FinancialEntryResponseDto })
  @ApiBadRequestResponse({ description: 'Dados invalidos ou campo nao permitido' })
  @ApiNotFoundResponse({ description: 'Lancamento nao encontrado' })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialEntryDto,
    @ClientIp() ip: string | null,
  ): Promise<FinancialEntryResponseDto> {
    const { entry, autor } = await this.financeService.update(actor, id, dto, ip);
    return toFinancialEntryResponse(entry, autor);
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionCode.FinanceStatus)
  @ApiOperation({
    summary: 'Altera o status do lancamento',
    description:
      'Exige `finance:status`. Transicoes permitidas: PENDENTE -> PAGO | CANCELADO e ' +
      'PAGO -> CANCELADO. CANCELADO e terminal. Repetir o status atual nao tem efeito.',
  })
  @ApiOkResponse({ type: FinancialEntryResponseDto })
  @ApiNotFoundResponse({ description: 'Lancamento nao encontrado' })
  @ApiConflictResponse({ description: 'Transicao de status nao permitida' })
  async changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntryStatusDto,
    @ClientIp() ip: string | null,
  ): Promise<FinancialEntryResponseDto> {
    const { entry, autor } = await this.financeService.changeStatus(actor, id, dto.status, ip);
    return toFinancialEntryResponse(entry, autor);
  }
}
