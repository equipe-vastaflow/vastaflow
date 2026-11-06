import {
  entryJson,
  FAKE_TOKEN,
  jsonResponse,
  listJson,
  ME_JSON,
} from '../../../../test/support/plantae-fixtures';
import { PlantaeApiError } from './plantae-errors';
import { PlantaeHttpClient } from './plantae-http.client';
import { parsePlantaeJson } from './plantae-json';
import { PlantaeRateLimiter } from './plantae-rate-limiter';
import { PlantaeEndpoint, type PlantaeEndpointPath } from './plantae.constants';
import { PlantaeService } from './plantae.service';

/**
 * Cliente HTTP e servico com os DOIS hosts. Tudo com `fetch` SIMULADO e token FALSO: nenhuma chamada real.
 * O destino e sempre o da configuracao validada; redirecionamento nunca e seguido; `links.next` de outro host (inclusive
 * do OUTRO ambiente) e recusado.
 */
const HOMOLOGACAO = 'https://rc.plantae.agr.br/api/v1/external';
const PRODUCAO = 'https://web.plantae.agr.br/api/v1/external';
const HOSTS = [
  ['homologacao', HOMOLOGACAO, 'rc.plantae.agr.br'],
  ['producao', PRODUCAO, 'web.plantae.agr.br'],
] as const;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

function config(baseUrl: string): { get: <T>(key: string) => T | undefined } {
  const values: Record<string, unknown> = {
    PLANTAE_ENABLED: true,
    PLANTAE_BASE_URL: baseUrl,
    PLANTAE_API_TOKEN: FAKE_TOKEN,
  };
  return { get: <T>(key: string): T | undefined => values[key] as T | undefined };
}

function client(baseUrl: string): {
  client: PlantaeHttpClient;
  fetch: jest.Mock<ReturnType<FetchFn>, Parameters<FetchFn>>;
} {
  const clock = { t: 1_000_000 };
  const sleep = (ms: number): Promise<void> => {
    clock.t += ms;
    return Promise.resolve();
  };
  const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
  return {
    client: new PlantaeHttpClient(config(baseUrl), {
      fetch: fetchMock as unknown as typeof fetch,
      limiter: new PlantaeRateLimiter({ now: () => clock.t, sleep }),
      sleep,
      random: () => 0,
      now: () => clock.t,
    }),
    fetch: fetchMock,
  };
}

const noParams = (): URLSearchParams => new URLSearchParams();

describe.each(HOSTS)('PlantaeHttpClient com %s', (_nome, base, host) => {
  it('chama SO o host configurado, em HTTPS, no caminho fixo, com o token apenas no cabecalho', async () => {
    const h = client(base);
    h.fetch.mockResolvedValue(jsonResponse(ME_JSON));

    await h.client.get(PlantaeEndpoint.Me, noParams());

    const [url, init] = h.fetch.mock.calls[0] ?? ['', {}];
    const alvo = new URL(url);
    expect(alvo.protocol).toBe('https:');
    expect(alvo.hostname).toBe(host);
    expect(alvo.port).toBe('');
    expect(alvo.pathname).toBe('/api/v1/external/me');
    expect(alvo.username + alvo.password + alvo.search + alvo.hash).toBe('');
    expect(url).not.toContain(FAKE_TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(init.redirect).toBe('manual');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('o token nunca vai a outro host, mesmo que o servidor mande um redirecionamento', async () => {
    const h = client(base);
    h.fetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/steal' } }),
    );

    let erro: unknown;
    try {
      await h.client.get(PlantaeEndpoint.Me, noParams());
    } catch (e) {
      erro = e;
    }

    expect(erro).toBeInstanceOf(PlantaeApiError);
    expect((erro as PlantaeApiError).kind).toBe('redirect');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const destinos = h.fetch.mock.calls.map(([url]) => new URL(url).hostname);
    expect(destinos).toEqual([host]);
  });

  it('redirecionamento para o OUTRO ambiente tambem nao e seguido', async () => {
    const outro = host === 'web.plantae.agr.br' ? 'rc.plantae.agr.br' : 'web.plantae.agr.br';
    const h = client(base);
    h.fetch.mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { Location: `https://${outro}/api/v1/external/me` },
      }),
    );

    await expect(h.client.get(PlantaeEndpoint.Me, noParams())).rejects.toMatchObject({
      kind: 'redirect',
    });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('403 (escopo ausente) e 401 (token recusado) viram categorias proprias, sem presumir escopo', async () => {
    for (const [status, kind] of [
      [403, 'forbidden'],
      [401, 'unauthorized'],
    ] as const) {
      const h = client(base);
      h.fetch.mockResolvedValue(
        jsonResponse('{"message":"sem escopo"}', {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(
        h.client.get(PlantaeEndpoint.FinancialEntries, noParams()),
      ).rejects.toMatchObject({
        kind,
      });
      expect(h.fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe.each(HOSTS)('PlantaeService com %s: links.next', (_nome, base, host) => {
  const get = (links: string): { service: PlantaeService } => {
    const getMock = jest.fn<Promise<unknown>, [PlantaeEndpointPath, URLSearchParams]>(() =>
      Promise.resolve(
        parsePlantaeJson(listJson([entryJson()], { nextCursor: 'zzz', linkNextOverride: links })),
      ),
    );
    return {
      service: new PlantaeService({ get: getMock } as unknown as PlantaeHttpClient, config(base)),
    };
  };
  const periodo = { dataInicio: '2026-09-01', dataFim: '2026-09-30' };
  const outroHost = host === 'web.plantae.agr.br' ? 'rc.plantae.agr.br' : 'web.plantae.agr.br';

  it('aceita o link do PROPRIO host (so valida; nunca o segue)', async () => {
    const { service } = get(`${base}/financial/entries?cursor=zzz`);

    const page = await service.listEntries(periodo);

    expect(page.pagination.nextCursor).toBe('zzz');
  });

  it.each([
    ['o OUTRO ambiente', `https://__OUTRO__/api/v1/external/financial/entries?cursor=zzz`],
    ['subdominio acrescentado', `https://x.__HOST__/api/v1/external/financial/entries?cursor=zzz`],
    [
      'host como subdominio de terceiro',
      `https://__HOST__.evil.com/api/v1/external/financial/entries?cursor=zzz`,
    ],
    ['http', `http://__HOST__/api/v1/external/financial/entries?cursor=zzz`],
    ['porta', `https://__HOST__:9999/api/v1/external/financial/entries?cursor=zzz`],
    ['credencial', `https://u:p@__HOST__/api/v1/external/financial/entries?cursor=zzz`],
    ['outro caminho', `https://__HOST__/outra/coisa?cursor=zzz`],
  ])('recusa link para %s', async (_n, modelo) => {
    const link = modelo.replace('__OUTRO__', outroHost).replace(/__HOST__/g, host);
    const { service } = get(link);

    const erro = await service.listEntries(periodo).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(PlantaeApiError);
    expect((erro as PlantaeApiError).kind).toBe('invalid-response');
    expect(JSON.stringify((erro as PlantaeApiError).detail)).not.toContain('evil.com');
  });
});
