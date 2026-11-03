import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isProductionUrl,
  NfseApiClient,
  NfseContractUnconfirmedError,
  NfseProductionNotAuthorizedError,
  createTransport,
  type NfseTransport,
} from './nfse-api.client';
import {
  NFSE_OFFICIAL_BASES,
  producaoAutorizacaoEsperada,
  resolveNfseSettings,
  validateNfseSettings,
} from './nfse-settings';

/**
 * AUTORIZACAO DE PRODUCAO: segunda chave, independente do contrato. Nenhum teste aqui faz rede: os transportes sao
 * falsos e o `https.request` e interceptado (lanca) para provar ATE ONDE a chamada chegaria.
 */
const CNPJ = '11222333000181';
const OUTRO_CNPJ = '34250070000110';
const AUTORIZACAO = producaoAutorizacaoEsperada(CNPJ);
const PRODUCAO_URL = NFSE_OFFICIAL_BASES.producao;
const RESTRITA_URL = NFSE_OFFICIAL_BASES.restrita;

const BASE_ENV = {
  NFSE_ENABLED: 'true',
  NFSE_CERT_PFX_PATH: '/run/secrets/ficticio.pfx',
  NFSE_CERT_PFX_PASSWORD: 'senha-ficticia',
  NFSE_PRESTADOR_CNPJ: CNPJ,
  NFSE_MUNICIPIO_EMISSOR_IBGE: '3106200',
  NFSE_OPCAO_SIMPLES: '3',
  NFSE_REGIME_ESPECIAL_TRIBUTACAO: '0',
  NFSE_DPS_SERIE: '1',
  NFSE_VALOR_MAXIMO: '5000',
};
const producao = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...BASE_ENV,
  NFSE_AMBIENTE: 'producao',
  NFSE_WIRE_CONTRACT_CONFIRMED: 'true',
  ...extra,
});
const restrita = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...BASE_ENV,
  NFSE_AMBIENTE: 'restrita',
  ...extra,
});

describe('NFS-e - autorizacao de producao: configuracao', () => {
  it('o valor exato e uma FRASE que embute o CNPJ do prestador (nao um booleano)', () => {
    expect(AUTORIZACAO).toBe(`EMITIR-NFSE-REAL-${CNPJ}`);
    expect(producaoAutorizacaoEsperada(OUTRO_CNPJ)).not.toBe(AUTORIZACAO);
  });

  it('desativada por padrao: producao com contrato confirmado e SEM autorizacao carrega, mas nao autorizada', () => {
    const result = resolveNfseSettings(producao());

    expect(result.ok && result.settings.producaoAutorizada).toBe(false);
  });

  it('com a frase exata, em producao: autorizada', () => {
    const result = resolveNfseSettings(producao({ NFSE_PRODUCAO_AUTORIZACAO: AUTORIZACAO }));

    expect(result.ok && result.settings.producaoAutorizada).toBe(true);
  });

  it.each([
    ['true'],
    ['TRUE'],
    ['1'],
    ['sim'],
    ['yes'],
    ['EMITIR-NFSE-REAL'],
    ['EMITIR-NFSE-REAL-'],
    [`emitir-nfse-real-${CNPJ}`],
    [`EMITIR-NFSE-REAL-${OUTRO_CNPJ}`],
    [`EMITIR-NFSE-REAL-${CNPJ}0`],
    [`EMITIR-NFSE-REAL-${CNPJ} `.replace(' ', '-X')],
    [`${CNPJ}`],
    ['AUTORIZO'],
  ])('valor inequivoco exigido: %j e recusado no boot e NAO autoriza', (valor) => {
    const env = producao({ NFSE_PRODUCAO_AUTORIZACAO: valor });

    const problems = validateNfseSettings(env);
    expect(problems.join(' ')).toMatch(/NFSE_PRODUCAO_AUTORIZACAO invalida/);
    // A mensagem cita o FORMATO fixo da frase; o valor digitado nunca e repetido (exceto se for so um pedaco do formato).
    const formato = 'EMITIR-NFSE-REAL-<CNPJ do prestador>';
    if (!formato.includes(valor)) {
      expect(problems.join(' ')).not.toContain(valor);
    }
    expect(resolveNfseSettings(env).ok).toBe(false);
  });

  it('a autorizacao de OUTRA empresa (CNPJ diferente) nao vale: nao se copia o .env de um CNPJ para outro', () => {
    const env = producao({ NFSE_PRODUCAO_AUTORIZACAO: producaoAutorizacaoEsperada(OUTRO_CNPJ) });

    expect(resolveNfseSettings(env).ok).toBe(false);
  });

  it('NAO e exigida na restrita (com e sem contrato confirmado)', () => {
    for (const wire of [undefined, 'false', 'true']) {
      const result = resolveNfseSettings(restrita({ NFSE_WIRE_CONTRACT_CONFIRMED: wire }));
      expect(result.ok && result.settings.producaoAutorizada).toBe(false);
      expect(validateNfseSettings(restrita({ NFSE_WIRE_CONTRACT_CONFIRMED: wire }))).toEqual([]);
    }
  });

  it('na restrita ela nao pode existir: trocar so NFSE_AMBIENTE nao herda uma autorizacao esquecida', () => {
    for (const valor of [AUTORIZACAO, 'true', 'x']) {
      const problems = validateNfseSettings(restrita({ NFSE_PRODUCAO_AUTORIZACAO: valor }));
      expect(problems.join(' ')).toMatch(/so se aplica a NFSE_AMBIENTE=producao/);
      expect(problems.join(' ')).not.toContain(valor);
    }
  });

  it.each([[undefined], ['false'], ['true'], [true], ['1'], ['TRUE'], ['sim']])(
    'contrato confirmado (%j) NUNCA autoriza producao sozinho',
    (wire) => {
      const result = resolveNfseSettings(producao({ NFSE_WIRE_CONTRACT_CONFIRMED: wire }));

      expect(result.ok && result.settings.producaoAutorizada).not.toBe(true);
    },
  );

  it('nenhuma outra variavel liga a autorizacao (ENABLED, contrato, base, perfis, serie, valor...)', () => {
    const outras = {
      NFSE_ENABLED: true,
      NFSE_WIRE_CONTRACT_CONFIRMED: true,
      NFSE_API_BASE_URL: 'http://localhost:9',
      NFSE_VALOR_MAXIMO: '999999',
      NFSE_CA_BUNDLE_PATH: '/x',
      NFSE_CONFIRMATION_TTL_MINUTES: '30',
    };

    const result = resolveNfseSettings(producao(outras));

    expect(result.ok && result.settings.producaoAutorizada).toBe(false);
  });

  it('desligada (NFSE_ENABLED=false): nada e avaliado, nem a autorizacao', () => {
    expect(
      validateNfseSettings({ NFSE_ENABLED: 'false', NFSE_PRODUCAO_AUTORIZACAO: 'qualquer' }),
    ).toEqual([]);
  });
});

describe('NFS-e - autorizacao de producao: limite do cliente HTTP', () => {
  const spy = (): { transport: NfseTransport; urls: string[] } => {
    const urls: string[] = [];
    return {
      urls,
      transport: (request) => {
        urls.push(request.url.toString());
        return Promise.resolve({ status: 500, body: '' });
      },
    };
  };
  const operations: [string, (api: NfseApiClient) => Promise<unknown>][] = [
    ['emit', (api) => api.emit('<DPS/>')],
    ['findByDps', (api) => api.findByDps('DPS1')],
    ['fetchNfse', (api) => api.fetchNfse('1'.repeat(50))],
  ];

  // [ambiente, contrato confirmado, autorizacao] -> o que o cliente faz
  const matrix: [string, boolean, boolean, 'bloqueia-producao' | 'contrato' | 'segue'][] = [
    ['producao', false, false, 'contrato'],
    ['producao', false, true, 'contrato'],
    ['producao', true, false, 'bloqueia-producao'],
    ['producao', true, true, 'segue'],
    ['restrita', false, false, 'contrato'],
    ['restrita', false, true, 'contrato'],
    ['restrita', true, false, 'segue'],
    ['restrita', true, true, 'segue'],
  ];

  describe.each(operations)('%s', (_nome, run) => {
    it.each(matrix)(
      'ambiente %s, contrato=%s, autorizacao=%s -> %s',
      async (ambiente, wire, auth, esperado) => {
        const probe = spy();
        const api = new NfseApiClient(
          {
            baseUrl: ambiente === 'producao' ? PRODUCAO_URL : RESTRITA_URL,
            testServer: false,
            wireContractConfirmed: wire,
            producaoAutorizada: auth,
          },
          probe.transport,
        );

        if (esperado === 'segue') {
          await run(api);
          expect(probe.urls).toHaveLength(1);
        } else {
          await expect(run(api)).rejects.toBeInstanceOf(
            esperado === 'contrato'
              ? NfseContractUnconfirmedError
              : NfseProductionNotAuthorizedError,
          );
          expect(probe.urls).toEqual([]);
        }
      },
    );
  });

  it('com contrato E autorizacao, a chamada segue ao host de PRODUCAO (so entao)', async () => {
    const probe = spy();
    const api = new NfseApiClient(
      {
        baseUrl: PRODUCAO_URL,
        testServer: false,
        wireContractConfirmed: true,
        producaoAutorizada: true,
      },
      probe.transport,
    );

    await api.emit('<DPS/>');

    expect(probe.urls).toEqual(['https://sefin.nfse.gov.br/SefinNacional/nfse']);
  });

  it('o bloqueio e por DESTINO: configuracao que aponta a producao com a flag de restrita ainda e barrada', async () => {
    const probe = spy();
    const api = new NfseApiClient(
      {
        baseUrl: PRODUCAO_URL,
        testServer: false,
        wireContractConfirmed: true,
        producaoAutorizada: false,
      },
      probe.transport,
    );

    await expect(api.emit('<DPS/>')).rejects.toBeInstanceOf(NfseProductionNotAuthorizedError);
    expect(probe.urls).toEqual([]);
  });

  it('o erro do portao nunca vira "incerta" nem "nao enviada": e relancado ao servico', async () => {
    const throwing: NfseTransport = () => Promise.reject(new NfseProductionNotAuthorizedError());
    const api = new NfseApiClient(
      {
        baseUrl: RESTRITA_URL,
        testServer: false,
        wireContractConfirmed: true,
        producaoAutorizada: false,
      },
      throwing,
    );

    await expect(api.emit('<DPS/>')).rejects.toBeInstanceOf(NfseProductionNotAuthorizedError);
    await expect(api.findByDps('DPS1')).rejects.toBeInstanceOf(NfseProductionNotAuthorizedError);
    await expect(api.fetchNfse('1'.repeat(50))).rejects.toBeInstanceOf(
      NfseProductionNotAuthorizedError,
    );
  });

  it.each([
    ['https://sefin.nfse.gov.br/SefinNacional/nfse', true],
    ['https://SEFIN.NFSE.GOV.BR/SefinNacional/nfse', true],
    ['https://sefin.nfse.gov.br./SefinNacional/nfse', true],
    ['https://sefin.nfse.gov.br:8443/x', true],
    ['http://sefin.nfse.gov.br/x', true],
    ['https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse', false],
    ['http://127.0.0.1:38790/nfse', false],
    ['http://nfse-fake:9/nfse', false],
    ['https://adn.nfse.gov.br/docs', false],
  ])(
    'destino %s e producao? %s (host, sem depender de esquema, porta ou caixa)',
    (url, esperado) => {
      expect(isProductionUrl(new URL(url))).toBe(esperado);
    },
  );
});

describe('NFS-e - autorizacao de producao: ultimo limite, antes de abrir conexao', () => {
  let httpsRequest: jest.SpyInstance;
  let httpRequest: jest.SpyInstance;

  beforeEach(() => {
    // Qualquer tentativa de rede LANCA: este teste nunca toca a internet, nem por acidente.
    httpsRequest = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('REDE-BLOQUEADA-PELO-TESTE');
    });
    httpRequest = jest.spyOn(http, 'request').mockImplementation(() => {
      throw new Error('REDE-BLOQUEADA-PELO-TESTE');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const transport = (producaoAutorizada: boolean): NfseTransport =>
    createTransport({ testServer: false, caBundlePath: null, producaoAutorizada }, null, 1000);

  it('sanidade: o interceptador realmente bloqueia a rede neste teste', () => {
    expect(() => https.request('https://example.invalid')).toThrow('REDE-BLOQUEADA-PELO-TESTE');
    httpsRequest.mockClear();
  });

  it('producao sem autorizacao: rejeita ANTES de abrir conexao (nenhuma chamada de rede, nem tentativa)', async () => {
    const send = transport(false);

    for (const method of ['POST', 'GET'] as const) {
      await expect(
        send({
          method,
          url: new URL(`${PRODUCAO_URL}/nfse`),
          body: method === 'POST' ? '{}' : undefined,
        }),
      ).rejects.toBeInstanceOf(NfseProductionNotAuthorizedError);
    }

    expect(httpsRequest).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('producao sem autorizacao, em http ou outra porta: tambem barrado (o host e o criterio)', async () => {
    const send = transport(false);

    for (const url of ['http://sefin.nfse.gov.br/nfse', 'https://sefin.nfse.gov.br:8443/nfse']) {
      await expect(send({ method: 'POST', url: new URL(url), body: '{}' })).rejects.toBeInstanceOf(
        NfseProductionNotAuthorizedError,
      );
    }

    expect(httpsRequest).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('producao AUTORIZADA: o portao se abre e a chamada chega ao ponto de rede (interceptado, sem sair)', async () => {
    await expect(
      transport(true)({ method: 'POST', url: new URL(`${PRODUCAO_URL}/nfse`), body: '{}' }),
    ).rejects.toThrow('REDE-BLOQUEADA-PELO-TESTE');

    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(String((httpsRequest.mock.calls[0] as [URL])[0])).toBe(`${PRODUCAO_URL}/nfse`);
  });

  it('restrita NAO exige autorizacao: chega ao ponto de rede mesmo com producaoAutorizada=false', async () => {
    await expect(
      transport(false)({ method: 'POST', url: new URL(`${RESTRITA_URL}/nfse`), body: '{}' }),
    ).rejects.toThrow('REDE-BLOQUEADA-PELO-TESTE');

    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });
});

describe('NFS-e - autorizacao de producao: nao ha atalho no repositorio', () => {
  const raiz = join(__dirname, '..', '..', '..', '..', '..');
  const read = (path: string): string => readFileSync(join(raiz, path), 'utf8');

  it('o Compose e o .env.example a entregam VAZIA (desativada por padrao)', () => {
    expect(read('docker-compose.production.yml')).toContain(
      'NFSE_PRODUCAO_AUTORIZACAO: ${NFSE_PRODUCAO_AUTORIZACAO:-}',
    );
    expect(read('.env.example')).toMatch(/^NFSE_PRODUCAO_AUTORIZACAO=\s*$/m);
  });

  it('nenhum arquivo versionado traz a frase de autorizacao preenchida (so o formato, em comentario)', () => {
    for (const arquivo of ['docker-compose.production.yml', '.env.example', 'docker-compose.yml']) {
      expect(read(arquivo)).not.toMatch(/EMITIR-NFSE-REAL-\d{14}/);
    }
  });
});
