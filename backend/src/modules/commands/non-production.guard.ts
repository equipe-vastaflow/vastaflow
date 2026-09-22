import { type CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment, type EnvironmentVariables } from '../../config/env.validation';

/**
 * Torna a rota indisponivel em producao.
 *
 * Usado pelo endpoint interno de teste do motor de comandos, que existe apenas
 * enquanto nao ha um canal real (Telegram, WhatsApp) para exercita-lo.
 *
 * Reusa o `NODE_ENV` ja validado - nenhuma variavel de ambiente nova. E o mesmo
 * criterio que o `env.validation` usa para proibir `DATABASE_SYNCHRONIZE` em
 * producao, entao o projeto passa a ter uma unica nocao de "isto nao vale em
 * producao".
 *
 * Le pelo `ConfigService`, e nao por `process.env` direto: o valor ja passou
 * pela validacao de ambiente, inclusive quando vem de um arquivo `.env`. Ler
 * `process.env` na definicao do modulo aconteceria antes do `.env` ser
 * carregado e poderia deixar o endpoint registrado por engano - uma falha que
 * abriria a rota em vez de fecha-la.
 *
 * Responde 404, e nao 403: para quem chama, a rota simplesmente nao existe.
 */
@Injectable()
export class NonProductionGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  canActivate(): boolean {
    if (this.config.get('NODE_ENV', { infer: true }) === Environment.Production) {
      throw new NotFoundException('Cannot POST /commands/execute');
    }
    return true;
  }
}
