import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthIndicatorResult } from '../health/health.types';
import { hasConfigValues } from './integration-config';
import { IntegrationCategory, IntegrationStatus } from './integration.enums';
import {
  DuplicateIntegrationError,
  IntegrationRegistry,
  UnknownIntegrationError,
} from './integration-registry';
import type { IntegrationMetadata, IntegrationProvider } from './integration.types';

/** Valor que NUNCA pode aparecer em nada que o registro devolva ou registre em log. */
const SEGREDO = 'segredo-que-nao-pode-vazar-123';

/**
 * Provider de teste com os metodos como `jest.Mock` (propriedades, e nao
 * metodos): assim as asserções sobre as chamadas nao separam um metodo do
 * objeto. Estruturalmente, satisfaz `IntegrationProvider`.
 */
interface ProviderDeTeste {
  metadata: IntegrationMetadata;
  getStatus: jest.Mock<Promise<IntegrationStatus>, []>;
  healthCheck: jest.Mock<Promise<HealthIndicatorResult>, []>;
}

/**
 * Provider de TESTE. Existe so neste arquivo: a aplicacao nao registra nenhum
 * provider falso. Nao simula dado de negocio - so identidade, estado e health.
 */
function provider(
  id: string,
  {
    status = IntegrationStatus.Ready,
    health = { status: 'ok', detail: 'respondendo' },
    category = IntegrationCategory.Messaging,
    name = `Integracao ${id}`,
  }: {
    status?: IntegrationStatus;
    health?: HealthIndicatorResult;
    category?: IntegrationCategory;
    name?: string;
  } = {},
): ProviderDeTeste {
  return {
    metadata: { id, name, category },
    getStatus: jest.fn(() => Promise.resolve(status)),
    healthCheck: jest.fn(() => Promise.resolve(health)),
  };
}

describe('IntegrationRegistry', () => {
  let registry: IntegrationRegistry;

  beforeEach(() => {
    registry = new IntegrationRegistry();
  });

  describe('registro', () => {
    it('registra e localiza pelo identificador', () => {
      const telegram = provider('telegram');

      registry.register(telegram);

      expect(registry.find('telegram')).toBe(telegram);
    });

    it('identificador inexistente: undefined no find', () => {
      registry.register(provider('telegram'));

      expect(registry.find('whatsapp')).toBeUndefined();
    });

    it('recusa identificador duplicado, mantendo o primeiro', () => {
      const primeiro = provider('telegram');
      registry.register(primeiro);

      expect(() => {
        registry.register(provider('telegram', { name: 'Outro' }));
      }).toThrow(DuplicateIntegrationError);
      expect(registry.find('telegram')).toBe(primeiro);
    });

    it('recusa registrar a mesma instancia duas vezes', () => {
      const telegram = provider('telegram');
      registry.register(telegram);

      expect(() => {
        registry.register(telegram);
      }).toThrow(DuplicateIntegrationError);
    });

    it.each([
      ['vazio', ''],
      ['maiusculas', 'Telegram'],
      ['espaco', 'tele gram'],
      ['comeca com digito', '1nfse'],
      ['longo demais', 'a'.repeat(41)],
    ])('recusa identificador invalido (%s)', (_caso, id) => {
      expect(() => {
        registry.register(provider(id));
      }).toThrow(/Identificador de integracao invalido/);
      expect(registry.all()).toEqual([]);
    });

    it('recusa nome em branco', () => {
      expect(() => {
        registry.register(provider('telegram', { name: '   ' }));
      }).toThrow(/sem nome/);
    });

    it('recusa categoria fora do enum', () => {
      expect(() => {
        registry.register(provider('telegram', { category: 'CRM' as IntegrationCategory }));
      }).toThrow(/categoria desconhecida/);
    });

    it('registrar nao executa nada do provider', () => {
      const telegram = provider('telegram');

      registry.register(telegram);
      registry.all();

      expect(telegram.getStatus).not.toHaveBeenCalled();
      expect(telegram.healthCheck).not.toHaveBeenCalled();
    });
  });

  describe('listagem', () => {
    it('sem registro: lista vazia', () => {
      expect(registry.all()).toEqual([]);
    });

    it('ordenada por identificador, independente da ordem de registro', () => {
      registry.register(provider('whatsapp'));
      registry.register(provider('email', { category: IntegrationCategory.Email }));
      registry.register(provider('telegram'));

      expect(registry.all().map(({ id }) => id)).toEqual(['email', 'telegram', 'whatsapp']);
    });

    it('devolve copias: alterar o resultado nao altera o registro', () => {
      registry.register(provider('telegram'));

      const [item] = registry.all() as IntegrationMetadata[];
      (item as { name: string }).name = 'Adulterado';

      expect(registry.all()[0].name).toBe('Integracao telegram');
    });
  });

  describe('status', () => {
    it('devolve identidade e estado', async () => {
      registry.register(provider('telegram', { status: IntegrationStatus.NotConfigured }));

      await expect(registry.status('telegram')).resolves.toEqual({
        id: 'telegram',
        name: 'Integracao telegram',
        category: IntegrationCategory.Messaging,
        status: IntegrationStatus.NotConfigured,
      });
    });

    it.each(Object.values(IntegrationStatus))('repassa o estado %s', async (status) => {
      registry.register(provider('telegram', { status }));

      expect((await registry.status('telegram')).status).toBe(status);
    });

    it('status nao dispara o health check', async () => {
      const telegram = provider('telegram');
      registry.register(telegram);

      await registry.status('telegram');

      expect(telegram.healthCheck).not.toHaveBeenCalled();
    });

    it('identificador inexistente: UnknownIntegrationError', async () => {
      await expect(registry.status('nada')).rejects.toBeInstanceOf(UnknownIntegrationError);
    });

    it('getStatus que lanca vira ERROR, sem propagar', async () => {
      const quebrado = provider('telegram');
      quebrado.getStatus.mockRejectedValue(new Error('falhou'));
      registry.register(quebrado);

      expect((await registry.status('telegram')).status).toBe(IntegrationStatus.Error);
    });

    it('estado fora do enum vira ERROR', async () => {
      registry.register(provider('telegram', { status: 'CONECTADO' as IntegrationStatus }));

      expect((await registry.status('telegram')).status).toBe(IntegrationStatus.Error);
    });
  });

  describe('health check', () => {
    it('READY: executa o health check do provider', async () => {
      const telegram = provider('telegram');
      registry.register(telegram);

      const report = await registry.healthCheck('telegram');

      expect(telegram.healthCheck).toHaveBeenCalledTimes(1);
      expect(report).toEqual({
        id: 'telegram',
        name: 'Integracao telegram',
        category: IntegrationCategory.Messaging,
        status: IntegrationStatus.Ready,
        // O provider devolveu 'respondendo'; o que sai e a mensagem do registro.
        health: { status: 'ok', detail: 'disponivel' },
      });
    });

    it.each([
      ['ok', 'disponivel'],
      ['degraded', 'disponivel com restricoes'],
      ['down', 'indisponivel'],
    ] as const)('estado %s: mensagem fixa "%s", escrita pelo registro', async (status, detail) => {
      registry.register(provider('telegram', { health: { status, detail: 'texto do provider' } }));

      expect((await registry.healthCheck('telegram')).health).toEqual({ status, detail });
    });

    it.each([IntegrationStatus.Disabled, IntegrationStatus.NotConfigured, IntegrationStatus.Error])(
      '%s: nao chama o provider e devolve health nulo',
      async (status) => {
        const telegram = provider('telegram', { status });
        registry.register(telegram);

        const report = await registry.healthCheck('telegram');

        expect(report.status).toBe(status);
        expect(report.health).toBeNull();
        expect(telegram.healthCheck).not.toHaveBeenCalled();
      },
    );

    it('health check que lanca vira down, com mensagem fixa', async () => {
      const quebrado = provider('telegram');
      quebrado.healthCheck.mockRejectedValue(new Error('ECONNREFUSED'));
      registry.register(quebrado);

      expect((await registry.healthCheck('telegram')).health).toEqual({
        status: 'down',
        detail: 'verificacao falhou',
      });
    });

    it('estado de health fora do vocabulario vira down', async () => {
      registry.register(
        provider('telegram', {
          health: { status: 'conectado' as HealthIndicatorResult['status'] },
        }),
      );

      expect((await registry.healthCheck('telegram')).health).toEqual({
        status: 'down',
        detail: 'indisponivel',
      });
    });

    it('identificador inexistente: UnknownIntegrationError', async () => {
      await expect(registry.healthCheck('nada')).rejects.toBeInstanceOf(UnknownIntegrationError);
    });
  });

  describe('integracao nao configurada', () => {
    /**
     * Como um provider real decidira o estado: pela presenca da configuracao,
     * sem ler o valor. Chaves de TESTE, que nao existem no `.env.example`.
     */
    function configuravel(config: ConfigService): ProviderDeTeste {
      return {
        metadata: { id: 'exemplo', name: 'Exemplo', category: IntegrationCategory.Other },
        getStatus: jest.fn(() =>
          Promise.resolve(
            hasConfigValues(config, ['TESTE_INTEGRACAO_TOKEN'])
              ? IntegrationStatus.Ready
              : IntegrationStatus.NotConfigured,
          ),
        ),
        healthCheck: jest.fn(() => Promise.resolve<HealthIndicatorResult>({ status: 'ok' })),
      };
    }

    it('sem a configuracao: NOT_CONFIGURED e nenhum health check', async () => {
      const exemplo = configuravel(new ConfigService({}));
      registry.register(exemplo);

      const report = await registry.healthCheck('exemplo');

      expect(report.status).toBe(IntegrationStatus.NotConfigured);
      expect(report.health).toBeNull();
      expect(exemplo.healthCheck).not.toHaveBeenCalled();
    });

    it('com a configuracao: READY, e o valor nao aparece no relatorio', async () => {
      registry.register(configuravel(new ConfigService({ TESTE_INTEGRACAO_TOKEN: SEGREDO })));

      const report = await registry.healthCheck('exemplo');

      expect(report.status).toBe(IntegrationStatus.Ready);
      expect(JSON.stringify(report)).not.toContain(SEGREDO);
    });
  });

  describe('ausencia de segredos', () => {
    /** Provider mal comportado: guarda o token em campos proprios e no health. */
    function vazador(): IntegrationProvider {
      return {
        metadata: {
          id: 'vazador',
          name: 'Vazador',
          category: IntegrationCategory.Messaging,
          token: SEGREDO,
          apiKey: SEGREDO,
        } as IntegrationMetadata,
        getStatus: () => Promise.resolve(IntegrationStatus.Ready),
        healthCheck: () =>
          Promise.resolve({
            status: 'ok',
            authorization: `Bearer ${SEGREDO}`,
          } as HealthIndicatorResult),
      };
    }

    it('listagem, status e health check devolvem apenas os campos previstos', async () => {
      registry.register(vazador());

      const saidas = [
        registry.all(),
        await registry.status('vazador'),
        await registry.healthCheck('vazador'),
      ];

      for (const saida of saidas) {
        expect(JSON.stringify(saida)).not.toContain(SEGREDO);
      }
      expect(Object.keys(await registry.healthCheck('vazador')).sort()).toEqual(
        ['category', 'health', 'id', 'name', 'status'].sort(),
      );
      expect((await registry.healthCheck('vazador')).health).toEqual({
        status: 'ok',
        detail: 'disponivel',
      });
    });

    /**
     * Provider malicioso ou descuidado que poe no `detail` exatamente o que nao
     * pode sair: URL com token, cabecalho, resposta bruta, pilha de erro.
     */
    describe('detail do provider nunca e exposto', () => {
      const MALICIOSOS: [string, string][] = [
        ['URL com token', `https://api.exemplo.test/bot${SEGREDO}/getMe`],
        ['cabecalho Authorization', `Authorization: Bearer ${SEGREDO}`],
        ['API key', `api_key=${SEGREDO}&secret=${SEGREDO}`],
        ['resposta bruta', JSON.stringify({ ok: false, token: SEGREDO, raw: 'x'.repeat(5000) })],
        ['pilha de erro', `Error: falhou ${SEGREDO}\n    at Client.request (client.js:10:5)`],
      ];

      it.each(
        MALICIOSOS.flatMap(([caso, detail]) =>
          (['ok', 'degraded', 'down'] as const).map((status) => [caso, status, detail] as const),
        ),
      )('%s com estado %s: so a mensagem do registro sai', async (_caso, status, detail) => {
        registry.register(provider('telegram', { health: { status, detail } }));

        const report = await registry.healthCheck('telegram');
        const publico = JSON.stringify(report);

        expect(publico).not.toContain(SEGREDO);
        expect(publico).not.toContain('https://');
        expect(publico).not.toContain('Bearer');
        expect(publico).not.toContain('client.js');
        expect(report.health?.detail).not.toBe(detail);
        expect(report.health?.detail?.length).toBeLessThanOrEqual(30);
      });

      it('detail que nao e texto tambem nao sai', async () => {
        registry.register(
          provider('telegram', {
            health: { status: 'ok', detail: { token: SEGREDO } as unknown as string },
          }),
        );

        expect((await registry.healthCheck('telegram')).health).toEqual({
          status: 'ok',
          detail: 'disponivel',
        });
      });

      it('excecao com o segredo na mensagem: resposta fixa, sem a mensagem', async () => {
        const quebrado = provider('telegram');
        quebrado.healthCheck.mockRejectedValue(
          new Error(`GET https://api.exemplo.test/bot${SEGREDO}/getMe falhou`),
        );
        registry.register(quebrado);

        const report = await registry.healthCheck('telegram');

        expect(report.health).toEqual({ status: 'down', detail: 'verificacao falhou' });
        expect(JSON.stringify(report)).not.toContain(SEGREDO);
      });

      it('a resposta fixa de falha nao e compartilhada entre chamadas', async () => {
        const quebrado = provider('telegram');
        quebrado.healthCheck.mockRejectedValue(new Error('falhou'));
        registry.register(quebrado);

        const primeiro = await registry.healthCheck('telegram');
        (primeiro.health as { detail?: string }).detail = 'adulterado';

        expect((await registry.healthCheck('telegram')).health).toEqual({
          status: 'down',
          detail: 'verificacao falhou',
        });
      });
    });

    it('o log de falha nao leva a mensagem do erro, que pode conter a URL com token', async () => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const quebrado = provider('telegram');
      quebrado.healthCheck.mockRejectedValue(
        new Error(`GET https://api.exemplo.test/bot${SEGREDO}/getMe falhou`),
      );
      registry.register(quebrado);

      await registry.healthCheck('telegram');

      expect(log).toHaveBeenCalled();
      for (const chamada of log.mock.calls) {
        expect(JSON.stringify(chamada)).not.toContain(SEGREDO);
      }
      log.mockRestore();
    });
  });

  describe('isolamento entre providers', () => {
    it('a falha de um nao afeta o outro', async () => {
      const quebrado = provider('telegram');
      quebrado.getStatus.mockRejectedValue(new Error('falhou'));
      registry.register(quebrado);
      registry.register(provider('whatsapp'));

      expect((await registry.status('telegram')).status).toBe(IntegrationStatus.Error);
      expect(await registry.healthCheck('whatsapp')).toMatchObject({
        status: IntegrationStatus.Ready,
        health: { status: 'ok' },
      });
    });

    it('consultar um nao executa nada do outro', async () => {
      const telegram = provider('telegram');
      const whatsapp = provider('whatsapp');
      registry.register(telegram);
      registry.register(whatsapp);

      await registry.healthCheck('telegram');

      expect(whatsapp.getStatus).not.toHaveBeenCalled();
      expect(whatsapp.healthCheck).not.toHaveBeenCalled();
    });

    it('registros diferentes nao compartilham estado', () => {
      registry.register(provider('telegram'));

      expect(new IntegrationRegistry().all()).toEqual([]);
    });
  });

  describe('ausencia de chamadas externas', () => {
    it('registro, listagem, status e health check nao usam fetch', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      registry.register(provider('telegram'));
      registry.register(provider('email', { status: IntegrationStatus.NotConfigured }));

      registry.all();
      await registry.status('telegram');
      await registry.healthCheck('telegram');
      await registry.healthCheck('email');

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});
