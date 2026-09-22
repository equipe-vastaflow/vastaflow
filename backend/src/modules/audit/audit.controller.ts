import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionCode } from '../permissions/permission-code.enum';
import { AuditService } from './audit.service';
import { AuditLogPageResponseDto } from './dto/audit-log-page-response.dto';
import { toAuditLogResponse } from './dto/audit-log-response.dto';
import { DEFAULT_PAGE_SIZE, ListAuditLogsQuery } from './dto/list-audit-logs.query';

@ApiTags('Audit')
@ApiBearerAuth('access-token')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(PermissionCode.AuditRead)
  @ApiOperation({
    summary: 'Lista os registros de auditoria, paginado',
    description:
      'Exige a permissao `audit:read` (ADMIN e GESTOR por padrao). Ordenado do mais ' +
      'recente para o mais antigo. O total permite ao cliente saber quantas paginas existem.',
  })
  @ApiOkResponse({ type: AuditLogPageResponseDto })
  @ApiBadRequestResponse({ description: 'Parametros de paginacao invalidos' })
  @ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
  @ApiForbiddenResponse({ description: 'Perfil sem a permissao necessaria' })
  async findPage(@Query() query: ListAuditLogsQuery): Promise<AuditLogPageResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const { items, total } = await this.auditService.findPage(page, limit);
    return {
      items: items.map(({ log, autor }) => toAuditLogResponse(log, autor)),
      total,
      page,
      limit,
    };
  }
}
