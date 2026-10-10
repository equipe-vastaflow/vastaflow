import { validateEnv } from '../../../config/env.validation';

const baseEnv = {
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'vastaflow',
  DATABASE_USER: 'vastaflow',
  DATABASE_PASSWORD: 'senha-de-teste',
};

const HOMOLOGACAO = 'https://rc.plantae.agr.br/api/v1/external';
const TOKEN = 'plt_TOKEN_FALSO_para_o_teste_de_ambiente_123';

function mensagem(env: Record<string, unknown>): string {
  try {
    validateEnv({ ...baseEnv, ...env });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('deveria ter falhado');
}

describe('validateEnv: Plantae', () => {
  it('desabilitado por padrao, sem exigir nenhuma variavel Plantae', () => {
    const env = validateEnv(baseEnv);

    expect(env.PLANTAE_ENABLED).toBe(false);
    expect(env.PLANTAE_BASE_URL).toBeUndefined();
    expect(env.PLANTAE_API_TOKEN).toBeUndefined();
    expect(env.PLANTAE_TIMEOUT_MS).toBeUndefined();
  });

  it('variaveis vazias (como o compose as repassa) equivalem a ausentes', () => {
    const env = validateEnv({
      ...baseEnv,
      PLANTAE_ENABLED: 'false',
      PLANTAE_BASE_URL: '',
      PLANTAE_API_TOKEN: '',
      PLANTAE_TIMEOUT_MS: '',
    });

    expect(env.PLANTAE_BASE_URL).toBeUndefined();
    expect(env.PLANTAE_API_TOKEN).toBeUndefined();
    expect(env.PLANTAE_TIMEOUT_MS).toBeUndefined();
  });

  it('habilitada, sem token: SOBE (a integracao fica NOT_CONFIGURED, nao derruba o resto)', () => {
    expect(() =>
      validateEnv({ ...baseEnv, PLANTAE_ENABLED: 'true', PLANTAE_BASE_URL: HOMOLOGACAO }),
    ).not.toThrow();
  });

  it('configuracao completa e valida', () => {
    expect(
      validateEnv({
        ...baseEnv,
        PLANTAE_ENABLED: 'true',
        PLANTAE_BASE_URL: HOMOLOGACAO,
        PLANTAE_API_TOKEN: TOKEN,
        PLANTAE_TIMEOUT_MS: '20000',
      }),
    ).toMatchObject({
      PLANTAE_ENABLED: true,
      PLANTAE_BASE_URL: HOMOLOGACAO,
      PLANTAE_API_TOKEN: TOKEN,
      PLANTAE_TIMEOUT_MS: 20000,
    });
  });

  it("PLANTAE_ENABLED so aceita 'true' ou 'false'", () => {
    expect(validateEnv({ ...baseEnv, PLANTAE_ENABLED: 'true' }).PLANTAE_ENABLED).toBe(true);
    expect(validateEnv({ ...baseEnv, PLANTAE_ENABLED: 'qualquer' }).PLANTAE_ENABLED).toBe(false);
  });

  describe('URL base: fail-fast', () => {
    it.each([
      'http://rc.plantae.agr.br/api/v1/external',
      'https://app.plantae.agr.br/api/v1/external',
      'https://rc.plantae.agr.br/api/v2/external',
      'https://rc.plantae.agr.br:8443/api/v1/external',
      'https://u:p@rc.plantae.agr.br/api/v1/external',
      'isto nao e uma url',
    ])('recusa %s', (url) => {
      expect(mensagem({ PLANTAE_BASE_URL: url })).toContain('PLANTAE_BASE_URL invalida');
    });

    it('valida a URL MESMO com a integracao desligada (erro de configuracao nao espera uso)', () => {
      expect(() =>
        validateEnv({ ...baseEnv, PLANTAE_ENABLED: 'false', PLANTAE_BASE_URL: 'http://x.com' }),
      ).toThrow(/PLANTAE_BASE_URL/);
    });

    it('a mensagem NAO repete a URL informada', () => {
      const texto = mensagem({ PLANTAE_BASE_URL: 'https://ZEBRA:SEGREDO-987@rc.plantae.agr.br/x' });

      expect(texto).not.toContain('SEGREDO-987');
      expect(texto).not.toContain('ZEBRA');
    });
  });

  describe('token', () => {
    it.each([
      ['com espaco', 'abc def ghi jkl'],
      ['curto demais', 'abc'],
      ['com quebra de linha', 'abcdefgh\r\nX-Evil: 1'],
    ])('recusa token %s', (_nome, token) => {
      expect(mensagem({ PLANTAE_API_TOKEN: token })).toContain('PLANTAE_API_TOKEN invalido');
    });

    it('a mensagem de erro NAO repete o token', () => {
      const segredo = 'plt SEGREDO-NAO-VAZAR com espaco';

      expect(mensagem({ PLANTAE_API_TOKEN: segredo })).not.toContain('SEGREDO-NAO-VAZAR');
    });

    it('um erro de OUTRA variavel tambem nao carrega o token no texto', () => {
      const texto = mensagem({ PLANTAE_API_TOKEN: TOKEN, JWT_SECRET: 'curto' });

      expect(texto).not.toContain(TOKEN);
    });
  });

  describe('timeout', () => {
    it.each(['999', '60001', 'abc', '1500.5'])('recusa %s', (valor) => {
      expect(mensagem({ PLANTAE_TIMEOUT_MS: valor })).toContain('PLANTAE_TIMEOUT_MS');
    });

    it.each(['1000', '15000', '60000'])('aceita %s', (valor) => {
      expect(validateEnv({ ...baseEnv, PLANTAE_TIMEOUT_MS: valor }).PLANTAE_TIMEOUT_MS).toBe(
        Number(valor),
      );
    });
  });
});
