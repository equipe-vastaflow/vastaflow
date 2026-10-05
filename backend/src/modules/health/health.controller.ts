import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';
import { ReadinessService } from './readiness.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly readinessService: ReadinessService,
  ) {}

  // Publico de proposito: o guard de autenticacao e global e negaria por padrao.
  @Public()
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

  // Publico pelo mesmo motivo do liveness: quem consulta prontidao e
  // infraestrutura, que nao tem credencial.
  @Public()
  @Get('readiness')
  @ApiOperation({
    summary: 'Verifica se a aplicacao consegue atender requisicoes',
    description:
      'Diferente de `GET /health`, que responde apenas se o processo esta vivo, esta rota ' +
      'verifica as dependencias sem as quais a aplicacao nao funciona - hoje, somente o banco. ' +
      'Responde 503 quando alguma esta indisponivel. Integracoes externas NAO sao verificadas: ' +
      'uma indisponibilidade de fornecedor nao deve tirar o VastaFlow do ar.',
  })
  @ApiOkResponse({ description: 'Aplicacao pronta', type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'Alguma dependencia essencial esta indisponivel',
    type: HealthResponseDto,
  })
  async readiness(
    // `passthrough` para ajustar o status sem abandonar a serializacao do Nest.
    //
    // A alternativa seria lancar `ServiceUnavailableException`, mas o filtro
    // global trata 5xx como falha do servidor: substituiria o corpo por "Erro
    // interno do servidor" com `incidentId` e registraria stack trace a cada
    // consulta da sonda. Readiness negativo e uma resposta esperada, nao um
    // incidente.
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    const { body, unavailable } = await this.readinessService.check();
    response.status(unavailable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK);
    return body;
  }
}
