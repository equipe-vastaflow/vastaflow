import { type ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function host(url: string, path: string): { host: ArgumentsHost; json: jest.Mock } {
  const json = jest.fn();
  const response = { status: jest.fn().mockReturnValue({ json }) };
  const request = { url, path, method: 'GET' };
  return {
    json,
    host: {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost,
  };
}

describe('AllExceptionsFilter: o que vai para o log', () => {
  let warn: jest.SpyInstance<void, unknown[]>;
  let error: jest.SpyInstance<void, unknown[]>;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('erro 4xx: registra metodo e CAMINHO, sem a query string (que pode ter dado pessoal)', () => {
    const { host: h } = host('/people?busca=000.000.000-00&x=1', '/people');

    new AllExceptionsFilter().catch(new BadRequestException('ruim'), h);

    const linha = String(warn.mock.calls[0]?.[0]);
    expect(linha).toContain('GET /people -> 400');
    expect(linha).not.toContain('000.000.000-00');
    expect(linha).not.toContain('busca');
  });

  it('erro 5xx: tambem sem a query string', () => {
    const { host: h } = host('/people?busca=SEGREDO', '/people');

    new AllExceptionsFilter().catch(new Error('falha interna'), h);

    expect(String(error.mock.calls[0]?.[0])).not.toContain('SEGREDO');
  });

  it('a RESPOSTA ao proprio chamador continua trazendo a URL pedida (formato inalterado)', () => {
    const { host: h, json } = host('/people?busca=abc', '/people');

    new AllExceptionsFilter().catch(new BadRequestException('ruim'), h);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, path: '/people?busca=abc' }),
    );
  });
});
