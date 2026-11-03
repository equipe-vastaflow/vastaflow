import { validateEnv } from './env.validation';

/**
 * Validacao de ambiente de PONTA A PONTA (`validateEnv`, o que roda no boot) para a autorizacao de producao da
 * NFS-e: a aplicacao RECUSA subir com a autorizacao errada ou fora de lugar. Sem rede, sem aplicacao.
 */
const baseEnv = {
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'vastaflow',
  DATABASE_USER: 'vastaflow',
  DATABASE_PASSWORD: 'senha-de-teste',
};
const CNPJ = '11222333000181';
const FRASE = `EMITIR-NFSE-REAL-${CNPJ}`;

const nfse = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...baseEnv,
  NFSE_ENABLED: 'true',
  NFSE_AMBIENTE: 'producao',
  NFSE_WIRE_CONTRACT_CONFIRMED: 'true',
  NFSE_CERT_PFX_PATH: '/run/secrets/ficticio.pfx',
  NFSE_CERT_PFX_PASSWORD: 'senha-ficticia',
  NFSE_PRESTADOR_CNPJ: CNPJ,
  NFSE_MUNICIPIO_EMISSOR_IBGE: '3106200',
  NFSE_OPCAO_SIMPLES: '3',
  NFSE_REGIME_ESPECIAL_TRIBUTACAO: '0',
  NFSE_DPS_SERIE: '1',
  NFSE_VALOR_MAXIMO: '5000',
  ...extra,
});

describe('validateEnv - autorizacao de producao da NFS-e', () => {
  it('padrao de fabrica: NFS-e desligada, sem autorizacao (nada e exigido nem avaliado)', () => {
    const env = validateEnv(baseEnv);

    expect(env.NFSE_ENABLED).toBe(false);
    expect(env.NFSE_PRODUCAO_AUTORIZACAO).toBeUndefined();
  });

  it('producao, contrato confirmado e SEM autorizacao: a configuracao e valida (o bloqueio e em tempo de envio)', () => {
    expect(() => validateEnv(nfse())).not.toThrow();
    expect(validateEnv(nfse()).NFSE_PRODUCAO_AUTORIZACAO).toBeUndefined();
  });

  it('a frase exata do CNPJ do prestador, em producao: aceita e preservada', () => {
    expect(validateEnv(nfse({ NFSE_PRODUCAO_AUTORIZACAO: FRASE })).NFSE_PRODUCAO_AUTORIZACAO).toBe(
      FRASE,
    );
  });

  it('valor vazio ou so com espacos conta como NAO definido (desativada)', () => {
    for (const valor of ['', '   ']) {
      expect(
        validateEnv(nfse({ NFSE_PRODUCAO_AUTORIZACAO: valor })).NFSE_PRODUCAO_AUTORIZACAO,
      ).toBe(undefined);
    }
  });

  it.each([
    ['true'],
    ['1'],
    ['sim'],
    ['EMITIR-NFSE-REAL'],
    ['emitir-nfse-real-11222333000181'],
    ['EMITIR-NFSE-REAL-34250070000110'],
    [`${FRASE}-X`],
  ])('producao com valor %j: a aplicacao RECUSA subir', (valor) => {
    expect(() => validateEnv(nfse({ NFSE_PRODUCAO_AUTORIZACAO: valor }))).toThrow(
      /NFSE_PRODUCAO_AUTORIZACAO invalida/,
    );
  });

  it('a frase exata com NFSE_AMBIENTE=restrita: a aplicacao RECUSA subir (autorizacao esquecida nao vale na restrita)', () => {
    expect(() =>
      validateEnv(nfse({ NFSE_AMBIENTE: 'restrita', NFSE_PRODUCAO_AUTORIZACAO: FRASE })),
    ).toThrow(/so se aplica a NFSE_AMBIENTE=producao/);
  });

  it('restrita sem autorizacao: aceita, com ou sem o contrato confirmado (a restrita nao a exige)', () => {
    expect(() => validateEnv(nfse({ NFSE_AMBIENTE: 'restrita' }))).not.toThrow();
    expect(() =>
      validateEnv(nfse({ NFSE_AMBIENTE: 'restrita', NFSE_WIRE_CONTRACT_CONFIRMED: 'false' })),
    ).not.toThrow();
  });

  it('com NFSE_ENABLED=false nada e avaliado (mesmo com valor invalido, a NFS-e esta desligada)', () => {
    expect(() =>
      validateEnv(nfse({ NFSE_ENABLED: 'false', NFSE_PRODUCAO_AUTORIZACAO: 'true' })),
    ).not.toThrow();
  });

  it('a autorizacao nao liga NFSE_ENABLED nem o contrato: sao variaveis independentes', () => {
    const env = validateEnv(
      nfse({
        NFSE_ENABLED: 'false',
        NFSE_WIRE_CONTRACT_CONFIRMED: 'false',
        NFSE_PRODUCAO_AUTORIZACAO: FRASE,
      }),
    );

    expect(env.NFSE_ENABLED).toBe(false);
    expect(env.NFSE_WIRE_CONTRACT_CONFIRMED).toBe(false);
  });

  it('producao sem contrato confirmado continua recusada mesmo COM a frase (as duas chaves sao exigidas)', () => {
    expect(() =>
      validateEnv(
        nfse({ NFSE_WIRE_CONTRACT_CONFIRMED: 'false', NFSE_PRODUCAO_AUTORIZACAO: FRASE }),
      ),
    ).toThrow(/NFSE_WIRE_CONTRACT_CONFIRMED=true/);
  });
});
