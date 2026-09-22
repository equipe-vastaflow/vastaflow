import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary-response.dto';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Indicadores do dashboard administrativo',
    description:
      'Somente leitura; nao gera registro de auditoria.\n\n' +
      'Nao existe permissao propria de dashboard: basta estar autenticado. Cada secao ' +
      'e devolvida apenas a quem tem a permissao correspondente (`usuarios` exige ' +
      '`users:read`, `auditoria` exige `audit:read`). Um perfil sem nenhuma das duas ' +
      'recebe `{}` com status 200.',
  })
  @ApiOkResponse({ type: DashboardSummaryResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
  getSummary(@CurrentUser() actor: AuthenticatedUser): Promise<DashboardSummaryResponseDto> {
    return this.dashboardService.getSummary(actor);
  }
}
