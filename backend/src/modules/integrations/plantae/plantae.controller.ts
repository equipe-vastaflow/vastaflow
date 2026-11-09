import { applyDecorators, Controller, Get, Header, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientIp } from '../../../common/decorators/client-ip.decorator';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import type { AuditMetadata } from '../../audit/entities/audit-log.entity';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { RoleName } from '../../roles/role-name.enum';
import { IntegrationRegistry } from '../integration-registry';
import type { IntegrationStatusReport } from '../integration.types';
import { PlantaeApiError } from './plantae-errors';
import { failureCode, toHttpException } from './plantae-http-errors';
import { maskSensitive } from './plantae-mask';
import {
  parseAccountsQuery,
  parseEntriesQuery,
  parseInvoicesQuery,
  parseLegalEntitiesQuery,
  parseMovementsQuery,
  parsePeopleQuery,
  parseStatementQuery,
} from './plantae-query.parser';
import { resolvePlantaeSettings } from './plantae-settings';
import { MAX_PAGES_PER_CALL, PER_PAGE_MAX, PLANTAE_PROVIDER_ID } from './plantae.constants';
import { PlantaeService } from './plantae.service';
import type {
  PlantaeIntegration,
  PlantaePage,
  PlantaePagination,
  PlantaeStatementPage,
} from './plantae.types';

/**
 * Query string crua. NAO pode se chamar `Query`: o nome colide com o decorador
 * `@Query()` e o TypeScript emitiria o DECORADOR como metadado do parametro, que
 * o `ValidationPipe` global trataria como uma classe a validar (400 em toda rota).
 */
type RawQuery = Record<string, unknown>;

/**
 * Resposta de listagem: os itens no formato do contrato (com CPF/CNPJ e numero de
 * conta mascarados, ver `plantae-mask.ts`), mais o que se sabe da paginacao.
 */
interface ListResponse<T> {
  readonly data: readonly T[];
  readonly pagination: PlantaePagination;
}

interface StatementResponse extends ListResponse<unknown> {
  readonly saldos: { readonly saldo_anterior: string; readonly saldo_final: string };
}

const PAGE_PARAMS = [
  {
    name: 'per_page',
    required: false,
    description: `Itens por pagina, de 1 a ${String(PER_PAGE_MAX)}`,
  },
  {
    name: 'cursor',
    required: false,
    description:
      'Cursor OPACO (`pagination.nextCursor` da resposta anterior). Nao monte nem altere',
  },
  {
    name: 'paginas',
    required: false,
    description: `Quantas paginas ler nesta chamada (1 a ${String(MAX_PAGES_PER_CALL)}; padrao 1)`,
  },
] as const;

const PERIOD_PARAMS = [
  { name: 'data_inicio', required: true, description: 'AAAA-MM-DD' },
  {
    name: 'data_fim',
    required: true,
    description: 'AAAA-MM-DD, incluido; periodo de ate 366 dias',
  },
] as const;

/** Documenta os parametros no Swagger, sem repetir um `@ApiQuery` por linha. */
function QueryDocs(
  ...params: readonly { name: string; required: boolean; description: string }[]
): MethodDecorator {
  return applyDecorators(...params.map((param) => ApiQuery(param)));
}

/**
 * Dado financeiro e pessoal nao fica em cache (navegador, proxy, disco). Em TODA
 * rota: o teste de arquitetura impede uma rota nova sem ele.
 */
function NoStore(): MethodDecorator {
  return Header('Cache-Control', 'no-store');
}

/**
 * Consultas ao Plantae. SOMENTE `GET`, SOMENTE pessoa autenticada com `plantae:read`.
 *
 * - `@RequirePermissions(plantae:read)` na classe: quem nao tem a permissao recebe
 *   403 (o ADMIN passa sempre; o GESTOR so se a permissao foi concedida ao perfil);
 * - SO do ADMIN, com `@Roles(Admin)` no METODO (o `RolesGuard` le o metodo antes da
 *   classe; a permissao da classe continua exigida): `GET /me` (diagnostico da chave)
 *   e `GET /fiscal/issued-invoices` (NF-e, fora do pedido financeiro da cliente).
 *   Nao ha `@Roles` na classe;
 * - CPF/CNPJ e numero de conta saem MASCARADOS (`plantae-mask.ts`), em qualquer nivel
 *   da resposta, e nada e guardado em cache (`Cache-Control: no-store`);
 * - NENHUMA rota e `@Public()` nem `@ServiceRoute()`: o token de servico do n8n
 *   NAO autentica aqui (o guard de JWT exige pessoa). O n8n so le dado
 *   financeiro depois de uma fase propria, com resolucao do usuario de origem;
 * - cada consulta ao Plantae e auditada (`PLANTAE_QUERIED`), sem filtros de
 *   pessoa, sem conteudo e sem valores;
 * - falha do Plantae vira 424/429 com codigo rastreavel: NUNCA ha fallback para
 *   dado local fingindo ser do Plantae.
 *
 * Os dados nao sao gravados em lugar nenhum.
 */
@ApiTags('Plantae')
@ApiBearerAuth('access-token')
@RequirePermissions(PermissionCode.PlantaeRead)
@Controller('integrations/plantae')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@ApiForbiddenResponse({
  description: 'Sem a permissao plantae:read (em /me e /fiscal/issued-invoices: sem ser ADMIN)',
})
@ApiResponse({
  status: 424,
  description:
    'Falha do Plantae ou integracao desligada/nao configurada. O texto traz um codigo `PLANTAE_*`',
})
@ApiResponse({ status: 429, description: 'Limite de consultas ao Plantae atingido' })
export class PlantaeController {
  constructor(
    private readonly service: PlantaeService,
    private readonly registry: IntegrationRegistry,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  @NoStore()
  @ApiOperation({
    summary: 'Estado da integracao com o Plantae',
    description:
      'Local: nao chama o Plantae. `environment` e `homologation` (rc.plantae.agr.br) ou `production` ' +
      '(web.plantae.agr.br, dados reais), conforme o host configurado; `null` se nao configurado. ' +
      'Nao devolve URL nem credencial.',
  })
  @ApiOkResponse({ description: 'Estado operacional' })
  async status(): Promise<IntegrationStatusReport & { environment: string | null }> {
    const report = await this.registry.status(PLANTAE_PROVIDER_ID);
    return { ...report, environment: resolvePlantaeSettings(this.config).environment };
  }

  @Get('me')
  @NoStore()
  // Diagnostico da chave: SO o ADMIN, mesmo para quem tem `plantae:read`.
  @Roles(RoleName.Admin)
  @ApiOperation({
    summary: 'GET /me do Plantae: integracao, organizacao e escopos da chave (somente ADMIN)',
    description: 'Primeiro teste de uma configuracao nova. Nao exige escopo no Plantae.',
  })
  async me(
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<{ data: PlantaeIntegration }> {
    const data = await this.execute(
      'me',
      actor,
      ip,
      {},
      () => this.service.getMe(),
      () => ({ paginas: 1, quantidade: 1 }),
    );
    return { data };
  }

  @Get('financial/entries')
  @NoStore()
  @QueryDocs(
    ...PERIOD_PARAMS,
    ...PAGE_PARAMS,
    { name: 'tipo', required: false, description: 'receita | despesa' },
    {
      name: 'status',
      required: false,
      description: '0 pendente, 1 quitada, 2 substituida (repetivel)',
    },
    { name: 'pessoa_id', required: false, description: 'ids de /people (repetivel)' },
    { name: 'razao_social_id', required: false, description: 'ids de /legal-entities (repetivel)' },
  )
  @ApiOperation({
    summary: 'Parcelas a pagar e a receber por vencimento',
    description:
      'Uma linha por PARCELA (nao por pagamento). Valores como texto decimal exato, na moeda ' +
      'do titulo. `status` 2 (substituida) NAO e cancelada.',
  })
  async entries(
    @Query() query: RawQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ListResponse<unknown>> {
    const filter = parseOrReject(() => parseEntriesQuery(query));
    return this.listing('financial/entries', actor, ip, period(filter), () =>
      this.service.listEntries(filter),
    );
  }

  @Get('financial/accounts')
  @NoStore()
  @QueryDocs(...PAGE_PARAMS, {
    name: 'tipo',
    required: false,
    description: '1 caixa, 2 bancaria, 3 aplicacao, 4 numerario em transito (repetivel)',
  })
  @ApiOperation({
    summary: 'Contas de caixa, bancarias, aplicacoes e numerario em transito',
    description: 'Nao traz saldo: o saldo vem do extrato.',
  })
  async accounts(
    @Query() query: RawQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ListResponse<unknown>> {
    const filter = parseOrReject(() => parseAccountsQuery(query));
    return this.listing('financial/accounts', actor, ip, {}, () =>
      this.service.listAccounts(filter),
    );
  }

  @Get('financial/movements')
  @NoStore()
  @QueryDocs(
    ...PERIOD_PARAMS,
    ...PAGE_PARAMS,
    { name: 'conta_id', required: false, description: 'ids de /accounts (repetivel)' },
    { name: 'natureza', required: false, description: 'C credito | D debito' },
    { name: 'origem', required: false, description: '1 a 13, conforme a colecao (repetivel)' },
    { name: 'conciliado', required: false, description: '1/true ou 0/false' },
  )
  @ApiOperation({
    summary: 'Movimentacoes financeiras (entradas e saidas das contas)',
    description:
      'Valores em reais. A API NAO inclui movimentos estornados nem compras no cartao de ' +
      'credito (aparece o pagamento da fatura): nao representa "toda" a movimentacao.',
  })
  async movements(
    @Query() query: RawQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ListResponse<unknown>> {
    const filter = parseOrReject(() => parseMovementsQuery(query));
    return this.listing('financial/movements', actor, ip, period(filter), () =>
      this.service.listMovements(filter),
    );
  }

  @Get('financial/account-statement')
  @NoStore()
  @QueryDocs(...PERIOD_PARAMS, ...PAGE_PARAMS, {
    name: 'conta_id',
    required: true,
    description: 'id de /accounts',
  })
  @ApiOperation({
    summary: 'Extrato de uma conta',
    description:
      '`saldos` sao do periodo inteiro, iguais em todas as paginas: nunca some nem calcule ' +
      'saldo a partir das linhas de uma pagina. Nao e conciliacao bancaria.',
  })
  async statement(
    @Query() query: RawQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<StatementResponse> {
    const filter = parseOrReject(() => parseStatementQuery(query));
    const page = await this.execute(
      'financial/account-statement',
      actor,
      ip,
      period(filter),
      () => this.service.getAccountStatement(filter),
      measure,
    );
    return statementResponse(page);
  }

  @Get('fiscal/issued-invoices')
  @NoStore()
  // Fora do escopo autorizado para quem tem so `plantae:read` (o pedido da cliente e
  // financeiro): SO o ADMIN. A permissao da classe continua exigida.
  @Roles(RoleName.Admin)
  @QueryDocs(
    ...PERIOD_PARAMS,
    ...PAGE_PARAMS,
    { name: 'razao_social_id', required: false, description: 'ids de /legal-entities (repetivel)' },
    { name: 'situacao', required: false, description: 'autorizada | cancelada' },
    { name: 'operacao', required: false, description: 'entrada | saida' },
  )
  @ApiOperation({
    summary: 'NF-e (modelo 55) emitidas (somente ADMIN)',
    description:
      'Somente DADOS de NF-e de producao, autorizadas ou canceladas. A API nao entrega XML nem ' +
      'DANFE, e isto NAO e NFS-e.',
  })
  async invoices(
    @Query() query: RawQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ListResponse<unknown>> {
    const filter = parseOrReject(() => parseInvoicesQuery(query));
    return this.listing('fiscal/issued-invoices', actor, ip, period(filter), () =>
      this.service.listIssuedInvoices(filter),
    );
  }

  @Get('organization/legal-entities')
  @NoStore()
  @QueryDocs(...PAGE_PARAMS)
  @ApiOperation({ summary: 'Razoes sociais da organizacao' })
  async legalEntities(
    @Query() query: RawQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ListResponse<unknown>> {
    const filter = parseOrReject(() => parseLegalEntitiesQuery(query));
    return this.listing('organization/legal-entities', actor, ip, {}, () =>
      this.service.listLegalEntities(filter),
    );
  }

  @Get('people')
  @NoStore()
  @QueryDocs(...PAGE_PARAMS, {
    name: 'busca',
    required: false,
    description: 'Parte do nome, nome fantasia, razao social ou CPF/CNPJ (2 a 100 caracteres)',
  })
  @ApiOperation({
    summary: 'Pessoas cadastradas (clientes, fornecedores, colaboradores)',
    description:
      'CPF/CNPJ sai MASCARADO (dado pessoal). O termo de `busca` nunca vai para log nem para auditoria.',
  })
  async people(
    @Query() query: RawQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @ClientIp() ip: string | null,
  ): Promise<ListResponse<unknown>> {
    const filter = parseOrReject(() => parsePeopleQuery(query));
    return this.listing('people', actor, ip, {}, () => this.service.listPeople(filter));
  }

  // --- internos -------------------------------------------------------------

  private async listing<T>(
    endpoint: string,
    actor: AuthenticatedUser | undefined,
    ip: string | null,
    audited: AuditMetadata,
    call: () => Promise<PlantaePage<T>>,
  ): Promise<ListResponse<T>> {
    const page = await this.execute(endpoint, actor, ip, audited, call, measure);
    return { data: maskSensitive(page.items), pagination: page.pagination };
  }

  /**
   * Executa a consulta e audita o resultado, sucesso ou falha DO PLANTAE.
   * Parametro invalido (400) acontece antes e nao e auditado: nada foi consultado.
   */
  private async execute<R>(
    endpoint: string,
    actor: AuthenticatedUser | undefined,
    ip: string | null,
    audited: AuditMetadata,
    call: () => Promise<R>,
    count: (result: R) => { paginas: number; quantidade: number },
  ): Promise<R> {
    try {
      const result = await call();
      await this.record(endpoint, actor, ip, {
        resultado: 'ok',
        ...count(result),
        ...audited,
      });
      return result;
    } catch (error) {
      if (error instanceof PlantaeApiError) {
        await this.record(endpoint, actor, ip, {
          resultado: 'erro',
          codigo: failureCode(error),
          ...audited,
        });
      }
      throw toHttpException(error);
    }
  }

  private record(
    endpoint: string,
    actor: AuthenticatedUser | undefined,
    ip: string | null,
    details: AuditMetadata,
  ): Promise<void> {
    return this.audit.record({
      ...(actor ? { usuarioId: actor.id } : {}),
      acao: AuditAction.PlantaeQueried,
      modulo: AuditModuleName.Plantae,
      descricao: `Consulta ao Plantae: ${endpoint}`,
      ip,
      metadados: {
        endpoint,
        ambiente: resolvePlantaeSettings(this.config).environment,
        ...details,
      },
    });
  }
}

/** Parametro invalido vira 400 (e nao 500): nada foi consultado, nada e auditado. */
function parseOrReject<F>(parse: () => F): F {
  try {
    return parse();
  } catch (error) {
    throw toHttpException(error);
  }
}

function measure(page: PlantaePage<unknown>): { paginas: number; quantidade: number } {
  return { paginas: page.pagination.pagesFetched, quantidade: page.items.length };
}

/** So o PERIODO vai para a auditoria: nunca ids de pessoa nem termo de busca. */
function period(filter: { dataInicio: string; dataFim: string }): AuditMetadata {
  return { de: filter.dataInicio, ate: filter.dataFim };
}

function statementResponse(page: PlantaeStatementPage): StatementResponse {
  return {
    data: maskSensitive(page.items),
    pagination: page.pagination,
    saldos: { saldo_anterior: page.saldoAnterior, saldo_final: page.saldoFinal },
  };
}
