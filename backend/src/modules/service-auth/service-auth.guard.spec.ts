import {
  type ExecutionContext,
  ForbiddenException,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ServiceRoute } from './decorators/service-route.decorator';
import {
  SERVICE_FORBIDDEN_MESSAGE,
  SERVICE_ROUTE_KEY,
  SERVICE_TOKEN_HEADER,
  SERVICE_UNAUTHORIZED_MESSAGE,
} from './service-auth.constants';
import { ServiceAuthGuard } from './service-auth.guard';
import type {
  CredentialDenial,
  CredentialLookup,
  ServiceCredentialsStore,
} from './service-credentials.store';
import { type AuthenticatedService, ServicePrincipalId, ServiceScope } from './service-principals';
import { generateServiceToken } from './service-token';

/** Controller de teste: um endpoint de cada tipo, marcado com os decoradores REAIS. */
class RotasDeTeste {
  @ServiceRoute(ServiceScope.Identity)
  servico(): void {}

  rotaHumana(): void {}

  // Marcada como rota de servico, mas SEM declarar escopo: configuracao errada.
  @SetMetadata(SERVICE_ROUTE_KEY, true)
  servicoSemEscopo(): void {}
}

const SERVICO: AuthenticatedService = {
  principal: ServicePrincipalId.N8n,
  credentialId: 'n8n-2026-10',
  scopes: [ServiceScope.Identity],
};

interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl: string;
  socket: { remoteAddress: string | undefined };
  servicePrincipal?: AuthenticatedService;
}

function requisicao(headers: FakeRequest['headers'] = {}): FakeRequest {
  return {
    headers,
    method: 'GET',
    originalUrl: '/service/identity?segredo=nao-deve-ir-para-o-log',
    socket: { remoteAddress: '172.19.0.9' },
  };
}

function contexto(request: FakeRequest, handler: () => void): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => RotasDeTeste,
  } as unknown as ExecutionContext;
}

/** A funcao do prototipo (e nao um `bind`), que e onde o decorador grava o metadado. */
function handler(nome: keyof RotasDeTeste): () => void {
  const funcao: unknown = Reflect.get(RotasDeTeste.prototype, nome);
  return funcao as () => void;
}

describe('ServiceAuthGuard', () => {
  let find: jest.Mock<CredentialLookup, [string]>;
  let guard: ServiceAuthGuard;
  let warn: jest.SpyInstance<void, unknown[]>;

  // O metadado do decorador mora na funcao do prototipo; `bind` criaria outra, sem ele.
  const servico = (): (() => void) => handler('servico');
  beforeEach(() => {
    find = jest.fn<CredentialLookup, [string]>();
    guard = new ServiceAuthGuard(new Reflector(), { find } as unknown as ServiceCredentialsStore);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('rota que NAO e de servico', () => {
    it('nao participa: devolve true sem olhar a requisicao nem o store', () => {
      const request = requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() });

      expect(guard.canActivate(contexto(request, handler('rotaHumana')))).toBe(true);

      expect(find).not.toHaveBeenCalled();
    });

    it('nao anexa identidade de servico, mesmo com um token valido no cabecalho', () => {
      find.mockReturnValue({ ok: true, service: SERVICO });
      const request = requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() });

      guard.canActivate(contexto(request, handler('rotaHumana')));

      expect(request.servicePrincipal).toBeUndefined();
    });
  });

  describe('rota de servico: sucesso', () => {
    it('autentica, anexa a identidade e libera', () => {
      const token = generateServiceToken();
      find.mockReturnValue({ ok: true, service: SERVICO });
      const request = requisicao({ [SERVICE_TOKEN_HEADER]: token });

      expect(guard.canActivate(contexto(request, servico()))).toBe(true);

      expect(find).toHaveBeenCalledWith(token);
      expect(request.servicePrincipal).toEqual(SERVICO);
    });
  });

  describe('rota de servico: autenticacao recusada (401)', () => {
    function tentar(request: FakeRequest): unknown {
      try {
        guard.canActivate(contexto(request, servico()));
        return undefined;
      } catch (error) {
        return error;
      }
    }

    it('cabecalho ausente', () => {
      const erro = tentar(requisicao());

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect((erro as UnauthorizedException).message).toBe(SERVICE_UNAUTHORIZED_MESSAGE);
      expect(find).not.toHaveBeenCalled();
    });

    it('cabecalho repetido (lista)', () => {
      const erro = tentar(
        requisicao({ [SERVICE_TOKEN_HEADER]: [generateServiceToken(), generateServiceToken()] }),
      );

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(find).not.toHaveBeenCalled();
    });

    it.each([
      ['vazio', ''],
      ['formato errado', 'isto-nao-e-um-token'],
      ['um JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.assinatura'],
      ['Bearer no lugar do token', `Bearer ${generateServiceToken()}`],
      ['dois tokens separados por virgula', `${generateServiceToken()}, ${generateServiceToken()}`],
    ])('token mal formado: %s (nem consulta o store)', (_nome, valor) => {
      const erro = tentar(requisicao({ [SERVICE_TOKEN_HEADER]: valor }));

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(find).not.toHaveBeenCalled();
    });

    it.each<CredentialDenial>([
      'not_configured',
      'store_unavailable',
      'store_invalid',
      'unknown',
      'revoked',
      'expired',
    ])('store recusa (%s): a resposta e IDENTICA, para nao revelar o motivo', (reason) => {
      find.mockReturnValue({ ok: false, reason });
      const erro = tentar(requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() }));

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect((erro as UnauthorizedException).message).toBe(SERVICE_UNAUTHORIZED_MESSAGE);
      expect((erro as UnauthorizedException).getResponse()).toEqual(
        new UnauthorizedException(SERVICE_UNAUTHORIZED_MESSAGE).getResponse(),
      );
    });

    it('nao anexa identidade quando recusa', () => {
      find.mockReturnValue({ ok: false, reason: 'revoked' });
      const request = requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() });

      tentar(request);

      expect(request.servicePrincipal).toBeUndefined();
    });
  });

  describe('rota de servico: autorizacao por escopo (403)', () => {
    it('credencial valida SEM o escopo exigido', () => {
      find.mockReturnValue({ ok: true, service: { ...SERVICO, scopes: [] } });
      const request = requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() });

      expect(() => guard.canActivate(contexto(request, servico()))).toThrow(
        new ForbiddenException(SERVICE_FORBIDDEN_MESSAGE),
      );
      expect(request.servicePrincipal).toBeUndefined();
    });

    it('rota de servico que NAO declara escopo e negada (erro de configuracao)', () => {
      find.mockReturnValue({ ok: true, service: SERVICO });
      const request = requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() });

      expect(() => guard.canActivate(contexto(request, handler('servicoSemEscopo')))).toThrow(
        ForbiddenException,
      );
    });

    it('autenticar NAO autoriza: a credencial valida nao basta sem o escopo', () => {
      // A separacao que o desenho exige: "este e o n8n" nao quer dizer "o n8n
      // pode fazer isto".
      find.mockReturnValue({
        ok: true,
        service: { ...SERVICO, scopes: [] },
      });

      expect(() =>
        guard.canActivate(
          contexto(requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() }), servico()),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('o token nunca aparece no log', () => {
    it('recusa por token desconhecido', () => {
      const token = generateServiceToken();
      find.mockReturnValue({ ok: false, reason: 'unknown' });

      try {
        guard.canActivate(contexto(requisicao({ [SERVICE_TOKEN_HEADER]: token }), servico()));
      } catch {
        // esperado
      }

      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    });

    it('token mal formado, mesmo contendo um token valido dentro', () => {
      const token = generateServiceToken();

      try {
        guard.canActivate(
          contexto(requisicao({ [SERVICE_TOKEN_HEADER]: `${token}, ${token}` }), servico()),
        );
      } catch {
        // esperado
      }

      expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    });

    it('falta de escopo', () => {
      const token = generateServiceToken();
      find.mockReturnValue({ ok: true, service: { ...SERVICO, scopes: [] } });

      try {
        guard.canActivate(contexto(requisicao({ [SERVICE_TOKEN_HEADER]: token }), servico()));
      } catch {
        // esperado
      }

      expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    });

    it('o log traz o motivo e a origem, mas nao a query string', () => {
      find.mockReturnValue({ ok: false, reason: 'revoked' });

      try {
        guard.canActivate(
          contexto(requisicao({ [SERVICE_TOKEN_HEADER]: generateServiceToken() }), servico()),
        );
      } catch {
        // esperado
      }

      const linha = String(warn.mock.calls[0]?.[0]);
      expect(linha).toContain('motivo=revoked');
      expect(linha).toContain('origem=172.19.0.9');
      expect(linha).toContain('GET /service/identity');
      expect(linha).not.toContain('segredo');
    });

    it('usa o endereco do SOCKET, nao um cabecalho que o chamador controla', () => {
      find.mockReturnValue({ ok: false, reason: 'unknown' });
      const request = requisicao({
        [SERVICE_TOKEN_HEADER]: generateServiceToken(),
        'x-forwarded-for': '6.6.6.6',
      });

      try {
        guard.canActivate(contexto(request, servico()));
      } catch {
        // esperado
      }

      expect(String(warn.mock.calls[0]?.[0])).not.toContain('6.6.6.6');
    });
  });
});
