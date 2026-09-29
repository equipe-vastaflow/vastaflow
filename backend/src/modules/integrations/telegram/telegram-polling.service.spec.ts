import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { TelegramApiError, type TelegramApiClient } from './telegram-api.client';
import { TelegramUpdateOutcome, type TelegramAdapter } from './telegram.adapter';
import {
  POLLING_INITIAL_BACKOFF_MS,
  POLLING_MAX_BACKOFF_MS,
  TelegramPollingService,
} from './telegram-polling.service';

const TOKEN_FALSO = 'TOKEN-FALSO-DE-TESTE-nao-e-token-real';

interface ClienteFalso {
  isConfigured: jest.Mock<boolean, []>;
  getUpdates: jest.Mock<Promise<unknown[]>, [number | undefined, AbortSignal | undefined]>;
}

interface AdapterFalso {
  handleUpdate: jest.Mock<Promise<TelegramUpdateOutcome>, [unknown]>;
}

/** Como o long polling real: fica pendente ate o sinal ser abortado. */
function aguardaAteAbortar(
  _offset: number | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown[]> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new TelegramApiError('getUpdates', 'aborted'));
    });
  });
}

/** Deixa as promessas pendentes andarem, sem depender de timers. */
async function drenar(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe('TelegramPollingService', () => {
  const criados: TelegramPollingService[] = [];
  let client: ClienteFalso;
  let adapter: AdapterFalso;
  let logs: jest.SpyInstance[];

  function servico({ habilitado = true } = {}): TelegramPollingService {
    const config = {
      get: (chave: string): unknown =>
        chave === 'TELEGRAM_POLLING_ENABLED'
          ? habilitado
          : chave === 'TELEGRAM_BOT_TOKEN'
            ? TOKEN_FALSO
            : undefined,
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const service = new TelegramPollingService(
      config,
      client as unknown as TelegramApiClient,
      adapter as unknown as TelegramAdapter,
    );
    criados.push(service);
    return service;
  }

  beforeEach(() => {
    client = {
      isConfigured: jest.fn(() => true),
      getUpdates: jest.fn(aguardaAteAbortar),
    };
    adapter = {
      handleUpdate: jest.fn((_raw: unknown) =>
        Promise.resolve<TelegramUpdateOutcome>(TelegramUpdateOutcome.Executed),
      ),
    };
    logs = (['log', 'warn', 'error', 'debug'] as const).map((nivel) =>
      jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined),
    );
  });

  afterEach(async () => {
    // Nenhum teste deixa polling vivo: o proximo precisa do processo livre.
    for (const service of criados.splice(0)) {
      await service.stop();
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('ciclo de vida', () => {
    it('sem TELEGRAM_POLLING_ENABLED: nao inicia e nao chama o Telegram', async () => {
      const service = servico({ habilitado: false });

      service.onApplicationBootstrap();
      await drenar();

      expect(service.isRunning()).toBe(false);
      expect(client.getUpdates).not.toHaveBeenCalled();
    });

    it('habilitado mas sem token: nao inicia, avisa e nao chama o Telegram', async () => {
      client.isConfigured.mockReturnValue(false);
      const service = servico();

      service.onApplicationBootstrap();
      await drenar();

      expect(service.isRunning()).toBe(false);
      expect(client.getUpdates).not.toHaveBeenCalled();
      expect(logs[1]).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_BOT_TOKEN ausente'));
    });

    it('habilitado e com token: inicia sem bloquear o boot', async () => {
      const service = servico();

      // `onApplicationBootstrap` e sincrono: o laco roda em segundo plano.
      expect(service.onApplicationBootstrap()).toBeUndefined();
      await drenar();

      expect(service.isRunning()).toBe(true);
      expect(client.getUpdates).toHaveBeenCalledTimes(1);
      expect(client.getUpdates).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    });

    it('start repetido no mesmo servico nao cria um segundo laco', async () => {
      const service = servico();

      expect(service.start()).toBe(true);
      expect(service.start()).toBe(false);
      await drenar();

      expect(client.getUpdates).toHaveBeenCalledTimes(1);
    });

    it('duas instancias no mesmo processo: so uma faz polling', async () => {
      const primeira = servico();
      const segunda = servico();

      expect(primeira.start()).toBe(true);
      expect(segunda.start()).toBe(false);
      await drenar();
      expect(client.getUpdates).toHaveBeenCalledTimes(1);

      await primeira.stop();
      expect(segunda.start()).toBe(true);
    });

    it('stop interrompe o long polling em curso e encerra o laco', async () => {
      const service = servico();
      service.start();
      await drenar();

      await service.stop();

      expect(service.isRunning()).toBe(false);
      const [, signal] = client.getUpdates.mock.calls[0];
      expect(signal?.aborted).toBe(true);
    });

    it('o shutdown do Nest para o polling', async () => {
      const service = servico();
      service.start();
      await drenar();

      await service.onApplicationShutdown();

      expect(service.isRunning()).toBe(false);
    });

    it('stop sem polling ativo nao faz nada', async () => {
      await expect(servico().stop()).resolves.toBeUndefined();
    });
  });

  describe('processamento', () => {
    it('entrega os updates ao adapter em ordem e confirma com offset = ultimo + 1', async () => {
      const lote = [{ update_id: 5 }, { update_id: 6 }];
      client.getUpdates.mockResolvedValueOnce(lote).mockImplementation(aguardaAteAbortar);
      const service = servico();

      service.start();
      await drenar();

      expect(adapter.handleUpdate.mock.calls.map(([u]) => u)).toEqual(lote);
      expect(client.getUpdates).toHaveBeenCalledTimes(2);
      expect(client.getUpdates.mock.calls[1][0]).toBe(7);
    });

    it('update ignorado pelo adapter tambem avanca o offset', async () => {
      adapter.handleUpdate.mockResolvedValue(TelegramUpdateOutcome.Ignored);
      client.getUpdates
        .mockResolvedValueOnce([{ update_id: 10 }])
        .mockImplementation(aguardaAteAbortar);
      const service = servico();

      service.start();
      await drenar();

      expect(client.getUpdates.mock.calls[1][0]).toBe(11);
    });
  });

  describe('falhas sem laco apertado', () => {
    it('erro de rede: espera 1s, depois 2s, sem nova chamada antes disso', async () => {
      jest.useFakeTimers();
      client.getUpdates.mockRejectedValue(new TelegramApiError('getUpdates', 'network'));
      const service = servico();

      service.start();
      await drenar();
      expect(client.getUpdates).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(POLLING_INITIAL_BACKOFF_MS - 1);
      expect(client.getUpdates).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.getUpdates).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(2 * POLLING_INITIAL_BACKOFF_MS - 1);
      expect(client.getUpdates).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.getUpdates).toHaveBeenCalledTimes(3);
    });

    it('a espera tem teto de 60s', async () => {
      jest.useFakeTimers();
      client.getUpdates.mockRejectedValue(new TelegramApiError('getUpdates', 'http', 502));
      const service = servico();

      service.start();
      // 1+2+4+8+16+32 = 63s ate a 7a tentativa; depois disso, sempre 60s.
      await jest.advanceTimersByTimeAsync(63_000);
      const antes = client.getUpdates.mock.calls.length;
      await jest.advanceTimersByTimeAsync(POLLING_MAX_BACKOFF_MS - 1);
      expect(client.getUpdates.mock.calls.length).toBe(antes);
      await jest.advanceTimersByTimeAsync(1);
      expect(client.getUpdates.mock.calls.length).toBe(antes + 1);
    });

    it('depois de um sucesso, a espera volta a 1s', async () => {
      jest.useFakeTimers();
      client.getUpdates
        .mockRejectedValueOnce(new TelegramApiError('getUpdates', 'network'))
        .mockRejectedValueOnce(new TelegramApiError('getUpdates', 'network'))
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new TelegramApiError('getUpdates', 'network'))
        .mockImplementation(aguardaAteAbortar);
      const service = servico();

      service.start();
      await jest.advanceTimersByTimeAsync(1_000 + 2_000);
      // 3a chamada teve sucesso e a 4a falhou logo em seguida.
      expect(client.getUpdates).toHaveBeenCalledTimes(4);
      await jest.advanceTimersByTimeAsync(POLLING_INITIAL_BACKOFF_MS);
      expect(client.getUpdates).toHaveBeenCalledTimes(5);
    });

    it('lote sem update_id valido conta como falha (nao repete o lote na hora)', async () => {
      jest.useFakeTimers();
      client.getUpdates.mockResolvedValue([{ sem: 'id' }]);
      const service = servico();

      service.start();
      await drenar();
      expect(client.getUpdates).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(POLLING_INITIAL_BACKOFF_MS - 1);
      expect(client.getUpdates).toHaveBeenCalledTimes(1);
    });

    it('stop durante a espera encerra na hora e nao deixa timer aberto', async () => {
      jest.useFakeTimers();
      client.getUpdates.mockRejectedValue(new TelegramApiError('getUpdates', 'network'));
      const service = servico();
      service.start();
      await drenar();
      expect(jest.getTimerCount()).toBe(1);

      await service.stop();

      expect(service.isRunning()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('erro inesperado do adapter nao derruba o laco', async () => {
      jest.useFakeTimers();
      adapter.handleUpdate.mockRejectedValueOnce(new Error('inesperado'));
      client.getUpdates
        .mockResolvedValueOnce([{ update_id: 1 }])
        .mockImplementation(aguardaAteAbortar);
      const service = servico();

      service.start();
      await drenar();
      await jest.advanceTimersByTimeAsync(POLLING_INITIAL_BACKOFF_MS);

      expect(service.isRunning()).toBe(true);
      // O offset ja tinha avancado: o update que quebrou nao volta.
      expect(client.getUpdates.mock.calls[1][0]).toBe(2);
    });
  });

  describe('logs', () => {
    it('nenhum log leva o token, nem nas falhas', async () => {
      jest.useFakeTimers();
      client.getUpdates.mockRejectedValue(new Error(`https://api.telegram.org/bot${TOKEN_FALSO}`));
      const service = servico();

      service.start();
      await jest.advanceTimersByTimeAsync(10_000);
      await service.stop();

      const registrado = JSON.stringify(logs.map((spy) => spy.mock.calls as unknown));
      expect(registrado).toContain('falha no polling');
      expect(registrado).not.toContain(TOKEN_FALSO);
      expect(registrado).not.toContain('api.telegram.org');
    });
  });
});
