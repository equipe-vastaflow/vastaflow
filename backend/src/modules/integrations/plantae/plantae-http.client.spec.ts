import {
  BASE_URL,
  FAKE_TOKEN,
  jsonResponse,
  ME_JSON,
} from '../../../../test/support/plantae-fixtures';
import { PlantaeApiError, type PlantaeFailure } from './plantae-errors';
import { PlantaeHttpClient } from './plantae-http.client';
import { PlantaeRateLimiter } from './plantae-rate-limiter';
import { PlantaeEndpoint } from './plantae.constants';

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

function config(overrides: Record<string, unknown> = {}): {
  get: <T>(key: string) => T | undefined;
} {
  const values: Record<string, unknown> = {
    PLANTAE_ENABLED: true,
    PLANTAE_BASE_URL: BASE_URL,
    PLANTAE_API_TOKEN: FAKE_TOKEN,
    ...overrides,
  };
  return { get: <T>(key: string): T | undefined => values[key] as T | undefined };
}

interface Harness {
  readonly client: PlantaeHttpClient;
  readonly fetch: jest.Mock<ReturnType<FetchFn>, Parameters<FetchFn>>;
  readonly sleeps: number[];
  readonly clock: { t: number };
}

function harness(
  options: {
    config?: Record<string, unknown>;
    limiter?: ConstructorParameters<typeof PlantaeRateLimiter>[0];
  } = {},
): Harness {
  const clock = { t: 1_000_000 };
  const sleeps: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    sleeps.push(ms);
    clock.t += ms;
    return Promise.resolve();
  };
  const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
  const client = new PlantaeHttpClient(config(options.config), {
    fetch: fetchMock as unknown as typeof fetch,
    limiter: new PlantaeRateLimiter({ now: () => clock.t, sleep, ...options.limiter }),
    sleep,
    random: () => 0,
    now: () => clock.t,
  });
  return { client, fetch: fetchMock, sleeps, clock };
}

async function falha(promise: Promise<unknown>): Promise<PlantaeApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PlantaeApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('deveria ter falhado');
}

const ME = PlantaeEndpoint.Me;
const noParams = (): URLSearchParams => new URLSearchParams();

describe('PlantaeHttpClient: antes da rede', () => {
  it('integracao desabilitada: falha SEM chamar o Plantae', async () => {
    const h = harness({ config: { PLANTAE_ENABLED: false } });

    expect((await falha(h.client.get(ME, noParams()))).kind).toBe('disabled');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['sem URL', { PLANTAE_BASE_URL: undefined }],
    ['URL invalida', { PLANTAE_BASE_URL: 'http://rc.plantae.agr.br/api/v1/external' }],
    ['URL de outro host', { PLANTAE_BASE_URL: 'https://exemplo.com/api/v1/external' }],
    ['sem token', { PLANTAE_API_TOKEN: undefined }],
    ['token vazio', { PLANTAE_API_TOKEN: '   ' }],
    ['token com espaco', { PLANTAE_API_TOKEN: 'abc def ghi jkl' }],
    ['token com quebra de linha', { PLANTAE_API_TOKEN: 'abcdefgh\r\nX-Evil: 1' }],
  ])('%s: nao configurada, SEM chamar o Plantae', async (_nome, extra) => {
    const h = harness({ config: extra });

    expect((await falha(h.client.get(ME, noParams()))).kind).toBe('not-configured');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('isConfigured: so a presenca, nunca o valor', () => {
    expect(harness().client.isConfigured()).toBe(true);
    expect(harness({ config: { PLANTAE_API_TOKEN: undefined } }).client.isConfigured()).toBe(false);
    expect(harness({ config: { PLANTAE_ENABLED: false } }).client.isConfigured()).toBe(false);
    expect(typeof harness().client.isConfigured()).toBe('boolean');
  });
});

describe('PlantaeHttpClient: a requisicao enviada', () => {
  async function enviada(
    params = noParams(),
    endpoint: string = ME,
  ): Promise<[string, RequestInit]> {
    const h = harness();
    h.fetch.mockResolvedValue(jsonResponse(ME_JSON));
    await h.client.get(endpoint as typeof ME, params);
    const call = h.fetch.mock.calls[0];
    if (!call) {
      throw new Error('fetch nao foi chamado');
    }
    return call;
  }

  it('e sempre GET, sem corpo', async () => {
    const [, init] = await enviada();

    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('envia o Bearer no cabecalho Authorization e pede JSON', async () => {
    const [, init] = await enviada();

    expect(init.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });
  });

  it('o token NAO vai na URL nem na query string', async () => {
    const [url] = await enviada(new URLSearchParams({ data_inicio: '2026-09-01' }));

    expect(url).not.toContain(FAKE_TOKEN);
    expect(url.toLowerCase()).not.toContain('token');
    expect(url.toLowerCase()).not.toContain('bearer');
    expect(url.toLowerCase()).not.toContain('authorization');
  });

  it('o token aparece em UM unico lugar da requisicao', async () => {
    const [url, init] = await enviada();
    const { headers, ...resto } = init;

    expect(JSON.stringify(resto)).not.toContain(FAKE_TOKEN);
    expect(url).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(headers).split(FAKE_TOKEN)).toHaveLength(2);
  });

  it('monta a URL: base + endpoint + query', async () => {
    const [url] = await enviada(
      new URLSearchParams([
        ['data_inicio', '2026-09-01'],
        ['status[]', '0'],
      ]),
      PlantaeEndpoint.FinancialEntries,
    );

    expect(url).toBe(`${BASE_URL}/financial/entries?data_inicio=2026-09-01&status%5B%5D=0`);
  });

  it('sem query: nao deixa "?" solto', async () => {
    const [url] = await enviada();

    expect(url).toBe(`${BASE_URL}/me`);
  });

  it('NAO segue redirect', async () => {
    const [, init] = await enviada();

    expect(init.redirect).toBe('manual');
  });

  it('tem timeout (AbortSignal)', async () => {
    const [, init] = await enviada();

    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('nao envia X-Tenant-Id nem cookie (o token ja identifica a organizacao)', async () => {
    const [, init] = await enviada();

    expect(Object.keys(init.headers as Record<string, string>).map((k) => k.toLowerCase())).toEqual(
      ['accept', 'authorization'],
    );
  });

  it('o host chamado e SEMPRE o da configuracao validada', async () => {
    const [url] = await enviada();

    expect(new URL(url).hostname).toBe('rc.plantae.agr.br');
    expect(new URL(url).protocol).toBe('https:');
  });
});

describe('PlantaeHttpClient: resposta 200', () => {
  it('devolve o JSON analisado, com numeros preservados', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(jsonResponse('{"data":{"v":8337.10}}'));

    const body = (await h.client.get(ME, noParams())) as { data: { v: { source: string } } };

    expect(body.data.v.source).toBe('8337.10');
  });

  it('aceita content-type com charset', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      jsonResponse('{"data":1}', {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
    );

    await expect(h.client.get(ME, noParams())).resolves.toBeDefined();
  });

  it('content-type que nao e JSON: invalid-response (nem tenta ler)', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      new Response('<html>manutencao</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe('invalid-response');
    expect(erro.message).not.toContain('manutencao');
  });

  it('JSON malformado: invalid-response, sem repetir o corpo', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(jsonResponse('{"cpf":"000.000.000-00", quebrado'));

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe('invalid-response');
    expect(erro.message).not.toContain('000.000.000-00');
  });

  it('corpo com UTF-8 invalido: invalid-response', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      new Response(new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect((await falha(h.client.get(ME, noParams()))).kind).toBe('invalid-response');
  });

  it('corpo acima do teto (Content-Length): recusado sem ler', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      jsonResponse('{}', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }),
    );

    expect((await falha(h.client.get(ME, noParams()))).kind).toBe('response-too-large');
  });

  it('corpo acima do teto SEM Content-Length: corta o fluxo e o cancela', async () => {
    const h = harness();
    let cancelado = false;
    let enviados = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        enviados += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (enviados > 50) {
          controller.close();
        }
      },
      cancel() {
        cancelado = true;
      },
    });
    h.fetch.mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    expect((await falha(h.client.get(ME, noParams()))).kind).toBe('response-too-large');
    expect(cancelado).toBe(true);
    expect(enviados).toBeLessThan(15);
  });
});

describe('PlantaeHttpClient: status HTTP', () => {
  it.each<[number, PlantaeFailure]>([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'http'],
    [400, 'http'],
    [409, 'http'],
  ])('%i -> %s, sem nova tentativa', async (status, kind) => {
    const h = harness();
    h.fetch.mockResolvedValue(jsonResponse('{"message":"texto do Plantae"}', { status }));

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe(kind);
    expect(erro.detail.httpStatus).toBe(status);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('a mensagem do Plantae NAO e repetida', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      jsonResponse('{"message":"CPF 000.000.000-00 nao autorizado"}', { status: 403 }),
    );

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.message).not.toContain('000.000.000-00');
    expect(JSON.stringify(erro.detail)).not.toContain('000.000.000-00');
  });

  describe('422', () => {
    it('traz so os NOMES dos parametros rejeitados', async () => {
      const h = harness();
      h.fetch.mockResolvedValue(
        jsonResponse(
          '{"message":"x","errors":{"data_inicio":["O valor 123.456.789-00 e invalido"],' +
            '"pessoa_id.0":["ruim"],"Nome Estranho!":["x"]}}',
          { status: 422 },
        ),
      );

      const erro = await falha(h.client.get(ME, noParams()));

      expect(erro.kind).toBe('rejected-parameters');
      expect(erro.detail.parameters).toEqual(['data_inicio', 'pessoa_id']);
      expect(JSON.stringify(erro)).not.toContain('123.456.789-00');
      expect(h.fetch).toHaveBeenCalledTimes(1);
    });

    it('corpo ilegivel: lista vazia, mesma falha', async () => {
      const h = harness();
      h.fetch.mockResolvedValue(jsonResponse('nao e json', { status: 422 }));

      const erro = await falha(h.client.get(ME, noParams()));

      expect(erro.kind).toBe('rejected-parameters');
      expect(erro.detail.parameters).toEqual([]);
    });
  });

  describe('3xx', () => {
    it('nunca segue o Location, mesmo para outro host', async () => {
      const h = harness();
      h.fetch.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example.com/captura' },
        }),
      );

      const erro = await falha(h.client.get(ME, noParams()));

      expect(erro.kind).toBe('redirect');
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(erro)).not.toContain('evil.example.com');
    });

    it.each([301, 302, 303, 307, 308])('%i e erro', async (status) => {
      const h = harness();
      h.fetch.mockResolvedValue(new Response(null, { status, headers: { Location: BASE_URL } }));

      expect((await falha(h.client.get(ME, noParams()))).kind).toBe('redirect');
    });
  });
});

describe('PlantaeHttpClient: tentativas', () => {
  it.each([500, 502, 503, 504])('%i: tenta 3 vezes e desiste', async (status) => {
    const h = harness();
    h.fetch.mockImplementation(() => Promise.resolve(jsonResponse('{}', { status })));

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe('server-error');
    expect(erro.detail.httpStatus).toBe(status);
    expect(h.fetch).toHaveBeenCalledTimes(3);
  });

  it('espera com backoff exponencial entre as tentativas (random=0: sem jitter)', async () => {
    const h = harness();
    h.fetch.mockImplementation(() => Promise.resolve(jsonResponse('{}', { status: 503 })));

    await falha(h.client.get(ME, noParams()));

    expect(h.sleeps).toEqual([500, 1000]);
  });

  it('o jitter soma ate 250 ms', async () => {
    const clock = { t: 0 };
    const sleeps: number[] = [];
    const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(() =>
      Promise.resolve(jsonResponse('{}', { status: 503 })),
    );
    const client = new PlantaeHttpClient(config(), {
      fetch: fetchMock as unknown as typeof fetch,
      limiter: new PlantaeRateLimiter({ now: () => clock.t, sleep: () => Promise.resolve() }),
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.999,
      now: () => clock.t,
    });

    await falha(client.get(ME, noParams()));

    expect(sleeps).toEqual([500 + 249, 1000 + 249]);
  });

  it('recupera: 503 e depois 200', async () => {
    const h = harness();
    h.fetch
      .mockResolvedValueOnce(jsonResponse('{}', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(ME_JSON));

    await expect(h.client.get(ME, noParams())).resolves.toBeDefined();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it('NUNCA repete mais de 3 vezes (sem laco infinito)', async () => {
    const h = harness();
    h.fetch.mockImplementation(() => Promise.resolve(jsonResponse('{}', { status: 500 })));

    await falha(h.client.get(ME, noParams()));
    await falha(h.client.get(ME, noParams()));

    expect(h.fetch).toHaveBeenCalledTimes(6);
  });

  it.each(['401', '403', '422'])('%s NAO e repetido', async (status) => {
    const h = harness();
    h.fetch.mockImplementation(() =>
      Promise.resolve(jsonResponse('{}', { status: Number(status) })),
    );

    await falha(h.client.get(ME, noParams()));

    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('PlantaeHttpClient: 429 e Retry-After', () => {
  it('Retry-After curto: espera e repete (uma vez, com sucesso)', async () => {
    const h = harness({ limiter: { maxWaitMs: 60_000 } });
    h.fetch
      .mockResolvedValueOnce(jsonResponse('{}', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(jsonResponse(ME_JSON));
    const antes = h.clock.t;

    await expect(h.client.get(ME, noParams())).resolves.toBeDefined();

    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.clock.t - antes).toBeGreaterThanOrEqual(3000);
  });

  it('Retry-After longo (3091 s, como na colecao): NAO repete e informa o tempo', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      jsonResponse('{}', { status: 429, headers: { 'Retry-After': '3091' } }),
    );

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe('rate-limited');
    expect(erro.detail.retryAfterSeconds).toBe(3091);
    expect(erro.detail.httpStatus).toBe(429);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('depois de um 429, as proximas chamadas NEM saem do processo', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      jsonResponse('{}', { status: 429, headers: { 'Retry-After': '3091' } }),
    );
    await falha(h.client.get(ME, noParams()));

    const segunda = await falha(h.client.get(ME, noParams()));

    expect(segunda.kind).toBe('rate-limited');
    expect(segunda.detail.retryAfterSeconds).toBe(3091);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('a pausa termina: apos o Retry-After a chamada volta a sair', async () => {
    const h = harness({ limiter: { maxWaitMs: 10_000 } });
    h.fetch
      .mockResolvedValueOnce(jsonResponse('{}', { status: 429, headers: { 'Retry-After': '60' } }))
      .mockResolvedValueOnce(jsonResponse(ME_JSON));
    await falha(h.client.get(ME, noParams()));
    h.clock.t += 61_000;

    await expect(h.client.get(ME, noParams())).resolves.toBeDefined();
  });

  it('sem Retry-After: pausa padrao de 60 s, sem repetir', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(jsonResponse('{}', { status: 429 }));

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.detail.retryAfterSeconds).toBe(60);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['abc', '-5', '1.5', '', '99999999999'])(
    'Retry-After invalido (%p): trata como ausente',
    async (valor) => {
      const h = harness();
      h.fetch.mockResolvedValue(
        jsonResponse('{}', { status: 429, headers: { 'Retry-After': valor } }),
      );

      expect((await falha(h.client.get(ME, noParams()))).detail.retryAfterSeconds).toBe(60);
    },
  );

  it('Retry-After enorme e limitado a 24 h', async () => {
    const h = harness();
    h.fetch.mockResolvedValue(
      jsonResponse('{}', { status: 429, headers: { 'Retry-After': '999999999' } }),
    );

    expect((await falha(h.client.get(ME, noParams()))).detail.retryAfterSeconds).toBe(86_400);
  });

  it('data HTTP no passado nao vira pausa negativa', async () => {
    const h = harness({ limiter: { maxWaitMs: 60_000 } });
    const passado = new Date(h.clock.t - 60_000).toUTCString();
    h.fetch
      .mockResolvedValueOnce(
        jsonResponse('{}', { status: 429, headers: { 'Retry-After': passado } }),
      )
      .mockResolvedValueOnce(jsonResponse(ME_JSON));

    await expect(h.client.get(ME, noParams())).resolves.toBeDefined();
  });

  it('Retry-After como data HTTP', async () => {
    const h = harness({ limiter: { maxWaitMs: 60_000 } });
    const quando = new Date(h.clock.t + 5000).toUTCString();
    h.fetch
      .mockResolvedValueOnce(
        jsonResponse('{}', { status: 429, headers: { 'Retry-After': quando } }),
      )
      .mockResolvedValueOnce(jsonResponse(ME_JSON));

    await expect(h.client.get(ME, noParams())).resolves.toBeDefined();
  });

  it('X-RateLimit-Remaining: 0 numa resposta 200 segura a proxima chamada', async () => {
    const h = harness({ limiter: { maxWaitMs: 1000 } });
    h.fetch.mockResolvedValue(
      jsonResponse(ME_JSON, {
        headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '0' },
      }),
    );
    await h.client.get(ME, noParams());

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe('rate-limited');
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('X-RateLimit-Remaining > 0 nao atrapalha', async () => {
    const h = harness({ limiter: { maxWaitMs: 1000 } });
    h.fetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(ME_JSON, { headers: { 'X-RateLimit-Remaining': '12' } })),
    );

    await h.client.get(ME, noParams());
    await h.client.get(ME, noParams());

    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('PlantaeHttpClient: falhas de rede', () => {
  function erroDeRede(code: string, mensagem: string): Error {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = Object.assign(new Error(mensagem), { code });
    return error;
  }

  it.each<[string, PlantaeFailure, number]>([
    ['ENOTFOUND', 'dns', 1],
    ['EAI_AGAIN', 'dns', 1],
    ['ECONNREFUSED', 'connection-refused', 3],
    ['ECONNRESET', 'network', 3],
    ['ETIMEDOUT', 'network', 3],
    ['CERT_HAS_EXPIRED', 'tls', 1],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls', 1],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'tls', 1],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls', 1],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls', 1],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls', 1],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls', 1],
  ])('%s -> %s (%i chamada(s))', async (code, kind, chamadas) => {
    const h = harness();
    h.fetch.mockImplementation(() => Promise.reject(erroDeRede(code, 'x')));

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe(kind);
    expect(h.fetch).toHaveBeenCalledTimes(chamadas);
  });

  it('erro de TLS NUNCA e contornado: nao ha opcao de aceitar certificado invalido', async () => {
    const h = harness();
    h.fetch.mockImplementation(() => Promise.reject(erroDeRede('CERT_HAS_EXPIRED', 'x')));

    await falha(h.client.get(ME, noParams()));

    const [, init] = h.fetch.mock.calls[0] ?? [];
    expect(JSON.stringify(init)).not.toMatch(/rejectUnauthorized|insecure|dispatcher|agent/i);
  });

  it('o erro original (que traz URL e token) e DESCARTADO, nem como cause', async () => {
    const h = harness();
    const original = erroDeRede('ECONNRESET', `falha em ${BASE_URL}/me com Bearer ${FAKE_TOKEN}`);
    h.fetch.mockImplementation(() => Promise.reject(original));

    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.message).not.toContain(FAKE_TOKEN);
    expect(erro.message).not.toContain('plantae');
    expect((erro as { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(erro)).not.toContain(FAKE_TOKEN);
    expect(String(erro.stack)).not.toContain(FAKE_TOKEN);
  });

  it('timeout real: o AbortSignal interrompe uma chamada que nao responde', async () => {
    const h = harness({ config: { PLANTAE_TIMEOUT_MS: 1000 } });
    h.fetch.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );

    const inicio = Date.now();
    const erro = await falha(h.client.get(ME, noParams()));

    expect(erro.kind).toBe('timeout');
    expect(h.fetch).toHaveBeenCalledTimes(3);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(2900);
  }, 15_000);

  it('timeout: erro de nome TimeoutError tambem e classificado', async () => {
    const h = harness();
    h.fetch.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' })),
    );

    expect((await falha(h.client.get(ME, noParams()))).kind).toBe('timeout');
  });
});

describe('PlantaeHttpClient: concorrencia', () => {
  it('no maximo 2 requisicoes em voo ao mesmo tempo', async () => {
    // A espera do limitador cede a vez a macrotarefas, como o `setTimeout` real faria.
    const h = harness({
      limiter: { maxWaitMs: 60_000, sleep: () => new Promise((resolve) => setImmediate(resolve)) },
    });
    let emVoo = 0;
    let maximo = 0;
    h.fetch.mockImplementation(async () => {
      emVoo += 1;
      maximo = Math.max(maximo, emVoo);
      await new Promise((resolve) => setImmediate(resolve));
      emVoo -= 1;
      return jsonResponse(ME_JSON);
    });

    await Promise.all(Array.from({ length: 8 }, () => h.client.get(ME, noParams())));

    expect(h.fetch).toHaveBeenCalledTimes(8);
    expect(maximo).toBeLessThanOrEqual(2);
  });

  it('uma rajada acima de 50/min e contida localmente, sem chegar ao Plantae', async () => {
    const h = harness({ limiter: { maxWaitMs: 100, maxConcurrent: 100 } });
    h.fetch.mockImplementation(() => Promise.resolve(jsonResponse(ME_JSON)));

    const resultados = await Promise.allSettled(
      Array.from({ length: 70 }, () => h.client.get(ME, noParams())),
    );

    expect(h.fetch).toHaveBeenCalledTimes(50);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(20);
  });
});

describe('PlantaeHttpClient: maxAttempts', () => {
  function comTentativas(maxAttempts: number): Harness {
    const h = harness();
    return {
      ...h,
      client: new PlantaeHttpClient(config(), {
        fetch: h.fetch as unknown as typeof fetch,
        limiter: new PlantaeRateLimiter({ now: () => h.clock.t, sleep: () => Promise.resolve() }),
        sleep: () => Promise.resolve(),
        random: () => 0,
        now: () => h.clock.t,
        maxAttempts,
      }),
    };
  }

  it.each([
    ['503', () => jsonResponse('{}', { status: 503 })],
    [
      '429 com Retry-After curto',
      () => jsonResponse('{}', { status: 429, headers: { 'Retry-After': '1' } }),
    ],
  ])('maxAttempts=1: %s NAO e repetido', async (_nome, resposta) => {
    const h = comTentativas(1);
    h.fetch.mockImplementation(() => Promise.resolve(resposta()));

    await falha(h.client.get(ME, noParams()));

    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts=1: timeout e falha de conexao tambem nao sao repetidos', async () => {
    const h = comTentativas(1);
    h.fetch.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' })),
    );

    expect((await falha(h.client.get(ME, noParams()))).kind).toBe('timeout');
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts=1 nao muda o resultado de uma chamada que da certo', async () => {
    const h = comTentativas(1);
    h.fetch.mockResolvedValue(jsonResponse(ME_JSON));

    await expect(h.client.get(ME, noParams())).resolves.toBeDefined();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([2, 3, 10, 1000])('maxAttempts=%i nunca passa de 3 (so pode reduzir)', async (valor) => {
    const h = comTentativas(valor);
    h.fetch.mockImplementation(() => Promise.resolve(jsonResponse('{}', { status: 503 })));

    await falha(h.client.get(ME, noParams()));

    expect(h.fetch).toHaveBeenCalledTimes(Math.min(valor, 3));
  });

  it.each([0, -5, Number.NaN])('maxAttempts=%p vira 1 tentativa, nunca zero', async (valor) => {
    const h = comTentativas(valor);
    h.fetch.mockImplementation(() => Promise.resolve(jsonResponse('{}', { status: 503 })));

    await falha(h.client.get(ME, noParams()));

    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
