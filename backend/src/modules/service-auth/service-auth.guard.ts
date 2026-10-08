import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ServiceAuthenticatedRequest } from './decorators/current-service.decorator';
import {
  SERVICE_FORBIDDEN_MESSAGE,
  SERVICE_ROUTE_KEY,
  SERVICE_SCOPES_KEY,
  SERVICE_TOKEN_HEADER,
  SERVICE_UNAUTHORIZED_MESSAGE,
} from './service-auth.constants';
import {
  type CredentialDenial,
  type CredentialLookup,
  ServiceCredentialsStore,
} from './service-credentials.store';
import type { ServiceScope } from './service-principals';
import { hasServiceTokenFormat } from './service-token';

/** Por que a autenticacao falhou: os motivos do store mais os dois que nascem ANTES dele. */
type AuthenticationDenial = CredentialDenial | 'missing' | 'malformed';

type Authentication =
  | Extract<CredentialLookup, { ok: true }>
  | { readonly ok: false; readonly reason: AuthenticationDenial };

/**
 * Guard GLOBAL de autenticacao e autorizacao de SERVICO.
 *
 * Registrado ANTES do `JwtAuthGuard` (ver `auth.module.ts`). So age em rotas
 * marcadas com `@ServiceRoute`; em toda outra rota devolve `true` sem olhar a
 * requisicao, e o fluxo humano segue exatamente como era.
 *
 * Numa rota de servico:
 * 1. le `X-Service-Token`; ausente, mal formado, desconhecido, revogado,
 *    expirado ou com o arquivo de credenciais indisponivel -> 401 com UMA
 *    mensagem so;
 * 2. anexa a identidade a `request.servicePrincipal`;
 * 3. confere os escopos que a rota exige -> 403 se faltar algum.
 *
 * O `JwtAuthGuard` roda depois e, em rota de servico, apenas CONFIRMA que este
 * guard autenticou (fail-closed): se este guard sumisse da lista, toda rota de
 * servico passaria a dar 401, e nao a ficar aberta.
 *
 * O token NUNCA vai para log nem para mensagem de erro.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  private readonly logger = new Logger(ServiceAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: ServiceCredentialsStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isServiceRoute = this.reflector.getAllAndOverride<boolean | undefined>(
      SERVICE_ROUTE_KEY,
      targets,
    );
    if (!isServiceRoute) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ServiceAuthenticatedRequest>();
    const outcome = this.authenticate(request.headers[SERVICE_TOKEN_HEADER]);
    if (!outcome.ok) {
      this.deny(request, outcome.reason);
      throw new UnauthorizedException(SERVICE_UNAUTHORIZED_MESSAGE);
    }

    const { service } = outcome;
    const required = this.reflector.getAllAndOverride<readonly ServiceScope[] | undefined>(
      SERVICE_SCOPES_KEY,
      targets,
    );
    // Rota de servico sem escopo declarado e erro de configuracao: nega.
    if (!required || required.length === 0 || !required.every((s) => service.scopes.includes(s))) {
      this.logger.warn(
        `Servico sem escopo: principal=${service.principal} credencial=${service.credentialId} ` +
          `${describe(request)}`,
      );
      throw new ForbiddenException(SERVICE_FORBIDDEN_MESSAGE);
    }

    request.servicePrincipal = service;
    return true;
  }

  private authenticate(header: string | string[] | undefined): Authentication {
    // Cabecalho repetido chega como lista ou como valores unidos por virgula:
    // nos dois casos nao tem o formato de UM token, e cai em 'malformed'.
    if (header === undefined) {
      return { ok: false, reason: 'missing' };
    }
    if (typeof header !== 'string' || !hasServiceTokenFormat(header)) {
      return { ok: false, reason: 'malformed' };
    }
    return this.store.find(header);
  }

  private deny(request: ServiceAuthenticatedRequest, reason: AuthenticationDenial): void {
    // O motivo real fica AQUI, no log do servidor. A resposta e sempre a mesma.
    this.logger.warn(`Autenticacao de servico recusada: motivo=${reason} ${describe(request)}`);
  }
}

/**
 * Metodo, caminho SEM query string e origem da conexao.
 *
 * Usa o endereco do SOCKET e nao `request.ip`: com `trust proxy`, `request.ip`
 * vem de `X-Forwarded-For`, que quem chama pode escrever. Num log de seguranca
 * o que importa e de onde a conexao realmente veio.
 */
function describe(request: ServiceAuthenticatedRequest): string {
  const path = request.originalUrl.split('?')[0];
  return `${request.method} ${path} origem=${request.socket.remoteAddress ?? 'desconhecida'}`;
}
