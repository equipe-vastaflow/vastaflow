import { BadRequestException, HttpException } from '@nestjs/common';
import { PlantaeApiError, PlantaeInputError, type PlantaeFailure } from './plantae-errors';
import { failureCode, toHttpException } from './plantae-http-errors';

const TODAS: readonly PlantaeFailure[] = [
  'disabled',
  'not-configured',
  'unauthorized',
  'forbidden',
  'rejected-parameters',
  'rate-limited',
  'timeout',
  'dns',
  'connection-refused',
  'tls',
  'network',
  'redirect',
  'server-error',
  'http',
  'invalid-response',
  'response-too-large',
  'pagination-inconsistent',
  'cursor-loop',
];

function http(kind: PlantaeFailure, detail = {}): HttpException {
  const error = toHttpException(new PlantaeApiError(kind, detail));
  if (!(error instanceof HttpException)) {
    throw new Error('esperava HttpException');
  }
  return error;
}

describe('toHttpException', () => {
  it.each(TODAS)('%s: tem status, codigo PLANTAE_* e texto', (kind) => {
    const error = http(kind);

    expect(error.message).toMatch(/^PLANTAE_[A-Z_]+: .+/);
    expect([424, 429]).toContain(error.getStatus());
  });

  it.each(TODAS)('%s: NUNCA e 5xx (o filtro global esconderia a causa)', (kind) => {
    expect(http(kind).getStatus()).toBeLessThan(500);
  });

  it.each(TODAS)('%s: NUNCA e 401/403 (seria confundido com o login do usuario)', (kind) => {
    expect([401, 403]).not.toContain(http(kind).getStatus());
  });

  it('429 so para limite de taxa', () => {
    expect(http('rate-limited').getStatus()).toBe(429);
    expect(TODAS.filter((k) => http(k).getStatus() === 429)).toEqual(['rate-limited']);
  });

  it.each<[PlantaeFailure, string]>([
    ['disabled', 'PLANTAE_DISABLED'],
    ['not-configured', 'PLANTAE_NOT_CONFIGURED'],
    ['unauthorized', 'PLANTAE_AUTH_REJECTED'],
    ['forbidden', 'PLANTAE_FORBIDDEN'],
    ['rejected-parameters', 'PLANTAE_REJECTED_PARAMETERS'],
    ['rate-limited', 'PLANTAE_RATE_LIMITED'],
    ['timeout', 'PLANTAE_TIMEOUT'],
    ['dns', 'PLANTAE_UNREACHABLE'],
    ['connection-refused', 'PLANTAE_UNREACHABLE'],
    ['network', 'PLANTAE_UNREACHABLE'],
    ['tls', 'PLANTAE_TLS_ERROR'],
    ['redirect', 'PLANTAE_INVALID_RESPONSE'],
    ['invalid-response', 'PLANTAE_INVALID_RESPONSE'],
    ['response-too-large', 'PLANTAE_INVALID_RESPONSE'],
    ['pagination-inconsistent', 'PLANTAE_INVALID_RESPONSE'],
    ['cursor-loop', 'PLANTAE_INVALID_RESPONSE'],
    ['server-error', 'PLANTAE_UPSTREAM_ERROR'],
    ['http', 'PLANTAE_UPSTREAM_ERROR'],
  ])('%s -> %s', (kind, codigo) => {
    expect(http(kind).message.startsWith(`${codigo}: `)).toBe(true);
    expect(failureCode(new PlantaeApiError(kind))).toBe(codigo);
  });

  it('o texto e fixo: nada do que o Plantae mandou e repetido', () => {
    const error = http('invalid-response', { where: 'data[3].cpf_cnpj [texto]', httpStatus: 200 });

    expect(error.message).not.toContain('cpf_cnpj');
    expect(error.message).not.toContain('data[3]');
  });

  it('rejected-parameters acrescenta so os NOMES dos parametros', () => {
    const error = http('rejected-parameters', { parameters: ['data_inicio', 'pessoa_id'] });

    expect(error.message).toContain('(parametros: data_inicio, pessoa_id)');
  });

  it('rate-limited informa quando tentar de novo', () => {
    expect(http('rate-limited', { retryAfterSeconds: 3091 }).message).toContain(
      'Tente novamente em 3091 s',
    );
  });

  it('PlantaeInputError vira 400 com a lista de problemas', () => {
    const error = toHttpException(new PlantaeInputError(['data_inicio e obrigatorio', 'x']));

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      message: ['data_inicio e obrigatorio', 'x'],
    });
  });

  it('erro que nao e da integracao volta como esta (vira 500 generico com incidentId)', () => {
    const original = new TypeError('bug');

    expect(toHttpException(original)).toBe(original);
  });

  it('valor que nem e Error vira Error generico, sem o conteudo', () => {
    const error = toHttpException({ token: 'SEGREDO' });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('SEGREDO');
  });
});
