import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Verifica a disponibilidade do servico',
    description:
      'Endpoint publico usado por load balancers, monitoramento e pelo proprio time. ' +
      'Nao exige autenticacao e nao expoe dados sensiveis.',
  })
  @ApiOkResponse({
    description: 'Servico disponivel',
    type: HealthResponseDto,
  })
  check(): Promise<HealthResponseDto> {
    return this.healthService.check();
  }
}
