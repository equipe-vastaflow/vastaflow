import {
  moneyToCents,
  normalizeMoney,
  resolveNfseBase,
  resolveNfseSettings,
  validateNfseSettings,
  NFSE_OFFICIAL_BASES,
} from './nfse-settings';

const VALID = {
  NFSE_ENABLED: 'true',
  NFSE_AMBIENTE: 'restrita',
  NFSE_CERT_PFX_PATH: '/run/secrets/certificado.pfx',
  NFSE_CERT_PFX_PASSWORD: 'senha-ficticia-do-certificado',
  NFSE_PRESTADOR_CNPJ: '11222333000181',
  NFSE_MUNICIPIO_EMISSOR_IBGE: '3106200',
  NFSE_OPCAO_SIMPLES: '3',
  NFSE_REGIME_ESPECIAL_TRIBUTACAO: '0',
  NFSE_DPS_SERIE: '1',
  NFSE_VALOR_MAXIMO: '5000',
};

describe('NFS-e - configuracao', () => {
  it('desligada (padrao): nada e exigido nem avaliado', () => {
    expect(validateNfseSettings({})).toEqual([]);
    expect(validateNfseSettings({ NFSE_ENABLED: 'false', NFSE_AMBIENTE: 'qualquer' })).toEqual([]);
    expect(validateNfseSettings({ NFSE_ENABLED: false })).toEqual([]);
  });

  it('ligada com tudo valido: resolve com a serie em 5 digitos e o limite como decimal exato', () => {
    const result = resolveNfseSettings(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.settings.serie).toBe('00001');
    expect(result.settings.valorMaximo).toBe('5000.00');
    expect(result.settings.tpAmb).toBe(2);
    expect(result.settings.baseUrl).toBe(NFSE_OFFICIAL_BASES.restrita);
    expect(result.settings.wireContractConfirmed).toBe(false);
    expect(result.settings.confirmationTtlMs).toBe(10 * 60_000);
  });

  it('ligada exige cada decisao fiscal: nao ha padrao tributario nem de ambiente', () => {
    for (const key of Object.keys(VALID)) {
      if (key === 'NFSE_ENABLED') {
        continue;
      }
      const env: Record<string, string> = { ...VALID };
      delete env[key];
      expect(validateNfseSettings(env).length).toBeGreaterThan(0);
    }
  });

  it('nao optante do Simples (exige IBS/CBS, nao implementado) bloqueia a ativacao', () => {
    const problems = validateNfseSettings({ ...VALID, NFSE_OPCAO_SIMPLES: '1' });
    expect(problems.join(' ')).toMatch(/IBS\/CBS/);
  });

  it('inscricao municipal e razao social respeitam os limites do leiaute', () => {
    expect(validateNfseSettings({ ...VALID, NFSE_PRESTADOR_IM: '1'.repeat(16) })).not.toEqual([]);
    expect(validateNfseSettings({ ...VALID, NFSE_PRESTADOR_IM: '1'.repeat(15) })).toEqual([]);
    expect(validateNfseSettings({ ...VALID, NFSE_PRESTADOR_NOME: 'x'.repeat(301) })).not.toEqual(
      [],
    );
    expect(
      validateNfseSettings({ ...VALID, NFSE_PRESTADOR_NOME: 'a' + String.fromCharCode(10) + 'b' }),
    ).not.toEqual([]);
  });

  it('serie fora da faixa de aplicativo proprio (1 a 49999) e recusada', () => {
    expect(validateNfseSettings({ ...VALID, NFSE_DPS_SERIE: '50000' })).not.toEqual([]);
    expect(validateNfseSettings({ ...VALID, NFSE_DPS_SERIE: '0' })).not.toEqual([]);
    expect(validateNfseSettings({ ...VALID, NFSE_DPS_SERIE: '49999' })).toEqual([]);
  });

  it('regime de apuracao do Simples so vale para ME/EPP', () => {
    expect(
      validateNfseSettings({ ...VALID, NFSE_OPCAO_SIMPLES: '2', NFSE_REGIME_APURACAO_SN: '1' }),
    ).not.toEqual([]);
    expect(validateNfseSettings({ ...VALID, NFSE_REGIME_APURACAO_SN: '1' })).toEqual([]);
  });

  it('producao exige o contrato de troca confirmado (homologacao nao)', () => {
    expect(validateNfseSettings({ ...VALID, NFSE_AMBIENTE: 'producao' }).join(' ')).toMatch(
      /NFSE_WIRE_CONTRACT_CONFIRMED/,
    );
    expect(
      validateNfseSettings({
        ...VALID,
        NFSE_AMBIENTE: 'producao',
        NFSE_WIRE_CONTRACT_CONFIRMED: 'true',
      }),
    ).toEqual([]);
  });

  it('as mensagens de erro nunca repetem a senha, o caminho do certificado nem o CNPJ', () => {
    const problems = validateNfseSettings({
      ...VALID,
      NFSE_PRESTADOR_CNPJ: '123',
      NFSE_AMBIENTE: 'x',
      NFSE_API_BASE_URL: 'http://evil.example/',
    }).join('\n');
    expect(problems).not.toContain(VALID.NFSE_CERT_PFX_PASSWORD);
    expect(problems).not.toContain(VALID.NFSE_CERT_PFX_PATH);
    expect(problems).not.toContain('evil.example');
  });

  it('a base da API so aceita servidor de teste em http; qualquer outro destino e recusado', () => {
    expect(resolveNfseBase('restrita', '').ok).toBe(true);
    expect(resolveNfseBase('restrita', 'http://127.0.0.1:9999')).toMatchObject({
      ok: true,
      testServer: true,
    });
    for (const bad of [
      'https://sefin.nfse.gov.br',
      'http://evil.example',
      'http://user:pass@localhost',
      'http://localhost/?a=1',
      'ftp://localhost',
      'nao e url',
    ]) {
      expect(resolveNfseBase('restrita', bad).ok).toBe(false);
    }
  });

  it('dinheiro: texto decimal exato, sem ponto flutuante', () => {
    expect(normalizeMoney('1500')).toBe('1500.00');
    expect(normalizeMoney('1500,5')).toBe('1500.50');
    expect(normalizeMoney('0,07')).toBe('0.07');
    expect(normalizeMoney('0.1')).toBe('0.10');
    expect(normalizeMoney('1.500,00')).toBeNull();
    expect(normalizeMoney('-1')).toBeNull();
    expect(normalizeMoney('1e3')).toBeNull();
    expect(moneyToCents('9999999999999.99')).toBe(999999999999999n);
  });
});
