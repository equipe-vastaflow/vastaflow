import { Controller, Get, Query } from '@nestjs/common';
import {
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
import { AuditLogResponseDto, toAuditLogResponse } from './dto/audit-log-response.dto';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query';

const DEFAULT_LIMIT = 50;

@ApiTags('Audit')
@ApiBearerAuth('access-token')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(PermissionCode.AuditRead)
  @ApiOperation({
    summary: 'Lista os registros de auditoria mais recentes',
    description: 'Exige a permissao `audit:read` (ADMIN e GESTOR por padrao).',
  })
  @ApiOkResponse({ type: [AuditLogResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
  @ApiForbiddenResponse({ description: 'Perfil sem a permissao necessaria' })
  async findLatest(@Query() query: ListAuditLogsQuery): Promise<AuditLogResponseDto[]> {
    const logs = await this.auditService.findLatest(query.limit ?? DEFAULT_LIMIT);
    return logs.map(toAuditLogResponse);
  }
}
