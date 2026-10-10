import { IntegrationRegistry } from '../integration-registry';
import { IntegrationCategory, IntegrationStatus } from '../integration.enums';
import { BASE_URL, FAKE_TOKEN } from '../../../../test/support/plantae-fixtures';
import { PlantaeApiError } from './plantae-errors';
import { PlantaeHttpClient } from './plantae-http.client';
import { PlantaeProvider } from './plantae.provider';
import type { PlantaeService } from './plantae.service';

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

function montar(
  overrides: Record<string, unknown> = {},
  getMe: () => Promise<unknown> = () => Promise.resolve({}),
): { provider: PlantaeProvider; getMe: jest.Mock; clock: { t: number } } {
  const cfg = config(overrides);
  const clock = { t: 0 };
  const getMeMock = jest.fn(getMe);
  const provider = new PlantaeProvider(
    new PlantaeHttpClient(cfg),
    { getMe: getMeMock } as unknown as PlantaeService,
    cfg,
    () => clock.t,
  );
  return { provider, getMe: getMeMock, clock };
}

describe('PlantaeProvider: identidade', () => {
  it('so dados publicos, na categoria OTHER', () => {
    const { provider } = montar();

    expect(provider.metadata).toEqual({
      id: 'plantae',
      name: 'Plantae',
      category: IntegrationCategory.Other,
    });
  });

  it('nao tem campo que carregue token, URL ou configuracao', () => {
    const { provider } = montar();

    expect(JSON.stringify(provider.metadata)).not.toContain(FAKE_TOKEN);
    expect(Object.keys(provider.metadata).sort()).toEqual(['category', 'id', 'name']);
  });
});

describe('PlantaeProvider.getStatus (local, sem rede)', () => {
  it('desabilitada -> DISABLED', async () => {
    expect(await montar({ PLANTAE_ENABLED: false }).provider.getStatus()).toBe(
      IntegrationStatus.Disabled,
    );
  });

  it('desabilitada -> DISABLED mesmo com tudo preenchido', async () => {
    expect(await montar({ PLANTAE_ENABLED: 'false' }).provider.getStatus()).toBe(
      IntegrationStatus.Disabled,
    );
  });

  it.each([
    ['sem token', { PLANTAE_API_TOKEN: undefined }],
    ['sem URL', { PLANTAE_BASE_URL: undefined }],
    ['URL invalida', { PLANTAE_BASE_URL: 'http://x.com' }],
    ['token invalido', { PLANTAE_API_TOKEN: 'com espaco no meio' }],
  ])('habilitada, %s -> NOT_CONFIGURED', async (_nome, extra) => {
    expect(await montar(extra).provider.getStatus()).toBe(IntegrationStatus.NotConfigured);
  });

  it('habilitada e configurada -> READY', async () => {
    expect(await montar().provider.getStatus()).toBe(IntegrationStatus.Ready);
  });

  it('nunca chama o Plantae', async () => {
    const { provider, getMe } = montar();

    await provider.getStatus();

    expect(getMe).not.toHaveBeenCalled();
  });
});

describe('PlantaeProvider.healthCheck', () => {
  it('ok quando GET /me responde', async () => {
    const { provider } = montar();

    expect(await provider.healthCheck()).toEqual({ status: 'ok' });
  });

  it('down quando o Plantae falha (qualquer categoria)', async () => {
    const { provider } = montar({}, () => Promise.reject(new PlantaeApiError('timeout')));

    expect(await provider.healthCheck()).toEqual({ status: 'down' });
  });

  it('nao devolve detail: nada do Plantae chega ao registro', async () => {
    const { provider } = montar({}, () =>
      Promise.reject(new PlantaeApiError('forbidden', { httpStatus: 403 })),
    );

    expect(await provider.healthCheck()).not.toHaveProperty('detail');
  });

  it('erro que NAO e do Plantae sobe (bug de programacao nao vira "down")', async () => {
    const { provider } = montar({}, () => Promise.reject(new TypeError('bug')));

    await expect(provider.healthCheck()).rejects.toThrow('bug');
  });

  it('reaproveita o resultado por 60 s: nao gasta a cota do Plantae', async () => {
    const { provider, getMe, clock } = montar();

    await provider.healthCheck();
    clock.t = 59_999;
    await provider.healthCheck();
    await provider.healthCheck();

    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('depois de 60 s consulta de novo', async () => {
    const { provider, getMe, clock } = montar();
    await provider.healthCheck();

    clock.t = 60_000;
    await provider.healthCheck();

    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it('o resultado "down" tambem e reaproveitado (nao martela um Plantae fora do ar)', async () => {
    const { provider, getMe } = montar({}, () => Promise.reject(new PlantaeApiError('network')));

    await provider.healthCheck();
    await provider.healthCheck();

    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('chamadas simultaneas dividem UMA consulta', async () => {
    let liberar: () => void = () => undefined;
    const { provider, getMe } = montar(
      {},
      () =>
        new Promise((resolve) => {
          liberar = () => {
            resolve({});
          };
        }),
    );

    const todas = Promise.all([
      provider.healthCheck(),
      provider.healthCheck(),
      provider.healthCheck(),
    ]);
    liberar();
    const resultados = await todas;

    expect(getMe).toHaveBeenCalledTimes(1);
    expect(resultados.every((r) => r.status === 'ok')).toBe(true);
  });

  it('falha inesperada nao deixa a consulta "pendurada": a proxima tenta de novo', async () => {
    const { provider, getMe } = montar({}, () => Promise.reject(new TypeError('bug')));
    await expect(provider.healthCheck()).rejects.toThrow();

    await expect(provider.healthCheck()).rejects.toThrow();

    expect(getMe).toHaveBeenCalledTimes(2);
  });
});

describe('PlantaeProvider no IntegrationRegistry', () => {
  it('registra sem chamar o Plantae', () => {
    const { provider, getMe } = montar();
    const registry = new IntegrationRegistry();

    registry.register(provider);

    expect(registry.all().map((m) => m.id)).toEqual(['plantae']);
    expect(getMe).not.toHaveBeenCalled();
  });

  it('health so roda com a integracao READY; desligada, o Plantae nem e consultado', async () => {
    const { provider, getMe } = montar({ PLANTAE_ENABLED: false });
    const registry = new IntegrationRegistry();
    registry.register(provider);

    const report = await registry.healthCheck('plantae');

    expect(report).toMatchObject({ status: IntegrationStatus.Disabled, health: null });
    expect(getMe).not.toHaveBeenCalled();
  });

  it('o relatorio publico traz a mensagem fixa do registro, sem token nem URL', async () => {
    const { provider } = montar();
    const registry = new IntegrationRegistry();
    registry.register(provider);

    const report = await registry.healthCheck('plantae');

    expect(report.health).toEqual({ status: 'ok', detail: 'disponivel' });
    expect(JSON.stringify(report)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(report)).not.toContain('plantae.agr.br');
  });

  it('Plantae fora do ar: "down", sem derrubar quem perguntou', async () => {
    const { provider } = montar({}, () => Promise.reject(new PlantaeApiError('dns')));
    const registry = new IntegrationRegistry();
    registry.register(provider);

    expect((await registry.healthCheck('plantae')).health).toEqual({
      status: 'down',
      detail: 'indisponivel',
    });
  });
});
