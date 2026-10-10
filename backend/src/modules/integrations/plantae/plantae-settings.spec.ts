import { isPlausibleToken, parsePlantaeBaseUrl, resolvePlantaeSettings } from './plantae-settings';

const HOMOLOGACAO = 'https://rc.plantae.agr.br/api/v1/external';

function config(values: Record<string, unknown>): { get: <T>(key: string) => T | undefined } {
  return { get: <T>(key: string): T | undefined => values[key] as T | undefined };
}

describe('parsePlantaeBaseUrl', () => {
  it('aceita a URL de homologacao e a identifica como tal', () => {
    expect(parsePlantaeBaseUrl(HOMOLOGACAO)).toEqual({
      ok: true,
      baseUrl: HOMOLOGACAO,
      environment: 'homologation',
    });
  });

  it('normaliza: barra final, maiusculas no host, espacos nas pontas', () => {
    expect(parsePlantaeBaseUrl(`  HTTPS://RC.Plantae.agr.br/api/v1/external/  `)).toMatchObject({
      ok: true,
      baseUrl: HOMOLOGACAO,
    });
  });

  it.each([
    ['http (sem TLS)', 'http://rc.plantae.agr.br/api/v1/external', 'https'],
    ['host desconhecido', 'https://api.exemplo.com/api/v1/external', 'host'],
    ['subdominio parecido', 'https://rc.plantae.agr.br.evil.com/api/v1/external', 'host'],
    ['host com prefixo parecido', 'https://xrc.plantae.agr.br/api/v1/external', 'host'],
    ['dominio de producao inventado', 'https://app.plantae.agr.br/api/v1/external', 'host'],
    ['IP literal', 'https://203.0.113.10/api/v1/external', 'host'],
    ['localhost', 'https://localhost/api/v1/external', 'host'],
    ['usuario e senha na URL', 'https://user:senha@rc.plantae.agr.br/api/v1/external', 'usuario'],
    ['porta explicita', 'https://rc.plantae.agr.br:8443/api/v1/external', 'porta'],
    ['query string', 'https://rc.plantae.agr.br/api/v1/external?x=1', 'query'],
    ['fragmento', 'https://rc.plantae.agr.br/api/v1/external#x', 'fragmento'],
    ['caminho diferente', 'https://rc.plantae.agr.br/api/v2/external', 'caminho'],
    ['sem caminho', 'https://rc.plantae.agr.br', 'caminho'],
    ['caminho mais longo', 'https://rc.plantae.agr.br/api/v1/external/financial', 'caminho'],
    ['nao e URL', 'isto nao e uma url', 'URL'],
    ['vazio', '', 'URL'],
  ])('recusa %s', (_nome, url, trecho) => {
    const result = parsePlantaeBaseUrl(url);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem).toContain(trecho);
  });

  it('a mensagem de erro NAO repete a URL (que pode conter credencial)', () => {
    const result = parsePlantaeBaseUrl(
      'https://ZEBRA-LOGIN:SEGREDO-123@rc.plantae.agr.br/api/v1/external',
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SEGREDO-123');
    expect(JSON.stringify(result)).not.toContain('ZEBRA-LOGIN');
  });
});

describe('isPlausibleToken', () => {
  it('aceita ASCII imprimivel sem espaco', () => {
    expect(isPlausibleToken('plt_abcDEF-123_xyz.456')).toBe(true);
    expect(isPlausibleToken('a'.repeat(512))).toBe(true);
  });

  it.each([
    ['vazio', ''],
    ['curto demais', 'abc'],
    ['longo demais', 'a'.repeat(513)],
    ['com espaco', 'abcd efgh1234'],
    ['com quebra de linha (injecao de cabecalho)', 'abcdefgh\r\nX-Evil: 1'],
    ['com tabulacao', 'abcdefgh\t1234'],
    ['com acento', 'chavé-secreta-123'],
    ['com caractere de controle', 'abcdefgh\u0000'],
  ])('recusa %s', (_nome, token) => {
    expect(isPlausibleToken(token)).toBe(false);
  });
});

describe('resolvePlantaeSettings', () => {
  it('desabilitada por padrao: sem nenhuma variavel', () => {
    expect(resolvePlantaeSettings(config({}))).toEqual({
      enabled: false,
      baseUrl: null,
      environment: null,
      timeoutMs: 15_000,
    });
  });

  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    ['', false],
    [undefined, false],
  ])('PLANTAE_ENABLED=%p -> %p (so "true" liga)', (valor, esperado) => {
    expect(resolvePlantaeSettings(config({ PLANTAE_ENABLED: valor })).enabled).toBe(esperado);
  });

  it('resolve a URL e o ambiente', () => {
    expect(
      resolvePlantaeSettings(config({ PLANTAE_ENABLED: true, PLANTAE_BASE_URL: HOMOLOGACAO })),
    ).toMatchObject({ enabled: true, baseUrl: HOMOLOGACAO, environment: 'homologation' });
  });

  it('URL invalida resolve para null (fail-closed), nunca para um valor aproveitado', () => {
    expect(
      resolvePlantaeSettings(
        config({
          PLANTAE_ENABLED: true,
          PLANTAE_BASE_URL: 'http://rc.plantae.agr.br/api/v1/external',
        }),
      ),
    ).toMatchObject({ enabled: true, baseUrl: null, environment: null });
  });

  it.each([
    [5000, 5000],
    ['5000', 5000],
    [1000, 1000],
    [60000, 60000],
    [999, 15_000],
    [60001, 15_000],
    [1500.5, 15_000],
    ['abc', 15_000],
    ['', 15_000],
    [undefined, 15_000],
  ])('PLANTAE_TIMEOUT_MS=%p -> %p', (valor, esperado) => {
    expect(resolvePlantaeSettings(config({ PLANTAE_TIMEOUT_MS: valor })).timeoutMs).toBe(esperado);
  });

  it('o objeto de configuracao NAO contem o token', () => {
    const settings = resolvePlantaeSettings(
      config({ PLANTAE_ENABLED: true, PLANTAE_API_TOKEN: 'plt_SEGREDO_nao_deve_aparecer' }),
    );

    expect(JSON.stringify(settings)).not.toContain('SEGREDO');
    expect(Object.keys(settings)).not.toContain('token');
  });
});
