import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationCategory, IntegrationStatus } from '../integration.enums';
import { IntegrationRegistry } from '../integration-registry';
import { TelegramApiClient, TelegramApiError } from './telegram-api.client';
import { TelegramProvider } from './telegram.provider';

const TOKEN_FALSO = 'TOKEN-FALSO-DE-TESTE-nao-e-token-real';

interface ClienteFalso {
  isConfigured: jest.Mock<boolean, []>;
  getMe: jest.Mock<Promise<void>, []>;
}

describe('TelegramProvider', () => {
  let client: ClienteFalso;
  let provider: TelegramProvider;

  beforeEach(() => {
    client = { isConfigured: jest.fn(() => true), getMe: jest.fn(() => Promise.resolve()) };
    provider = new TelegramProvider(client as unknown as TelegramApiClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('metadata: so identidade publica, sem nada do bot nem do token', () => {
    expect(provider.metadata).toEqual({
      id: 'telegram',
      name: 'Telegram',
      category: IntegrationCategory.Messaging,
    });
  });

  describe('getStatus', () => {
    it('sem token: NOT_CONFIGURED, sem chamar o Telegram', async () => {
      client.isConfigured.mockReturnValue(false);

      expect(await provider.getStatus()).toBe(IntegrationStatus.NotConfigured);
      expect(client.getMe).not.toHaveBeenCalled();
    });

    it('com token: READY, sem chamar o Telegram', async () => {
      expect(await provider.getStatus()).toBe(IntegrationStatus.Ready);
      expect(client.getMe).not.toHaveBeenCalled();
    });

    it('com o cliente real e sem token: NOT_CONFIGURED e nenhum fetch', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      const real = new TelegramProvider(new TelegramApiClient(new ConfigService({})));

      expect(await real.getStatus()).toBe(IntegrationStatus.NotConfigured);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('getMe aceito: ok', async () => {
      expect(await provider.healthCheck()).toEqual({ status: 'ok' });
      expect(client.getMe).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['timeout', new TelegramApiError('getMe', 'timeout')],
      ['HTTP 401', new TelegramApiError('getMe', 'http', 401)],
      ['resposta invalida', new TelegramApiError('getMe', 'invalid-response')],
    ])('falha do Telegram (%s): down, com log seguro', async (_caso, erro) => {
      client.getMe.mockRejectedValue(erro);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      expect(await provider.healthCheck()).toEqual({ status: 'down' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(erro.message));
    });

    it('erro inesperado sobe para o registro, que ja o trata', async () => {
      client.getMe.mockRejectedValue(new Error('inesperado'));

      await expect(provider.healthCheck()).rejects.toThrow('inesperado');
    });
  });

  describe('no IntegrationRegistry', () => {
    let registry: IntegrationRegistry;

    beforeEach(() => {
      registry = new IntegrationRegistry();
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('nao configurado: health nao e tentado', async () => {
      client.isConfigured.mockReturnValue(false);
      registry.register(provider);

      const report = await registry.healthCheck('telegram');

      expect(report).toMatchObject({ status: IntegrationStatus.NotConfigured, health: null });
      expect(client.getMe).not.toHaveBeenCalled();
    });

    it('configurado e fora do ar: down, com a mensagem fixa do registro', async () => {
      client.getMe.mockRejectedValue(new TelegramApiError('getMe', 'network'));
      registry.register(provider);

      expect((await registry.healthCheck('telegram')).health).toEqual({
        status: 'down',
        detail: 'indisponivel',
      });
    });

    it('nenhum relatorio leva o token', async () => {
      const real = new TelegramProvider(
        new TelegramApiClient(new ConfigService({ TELEGRAM_BOT_TOKEN: TOKEN_FALSO })),
      );
      jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new TypeError(`fetch failed .../bot${TOKEN_FALSO}/getMe`));
      registry.register(real);

      const saidas = [
        registry.all(),
        await registry.status('telegram'),
        await registry.healthCheck('telegram'),
      ];

      expect(JSON.stringify(saidas)).not.toContain(TOKEN_FALSO);
    });
  });
});
