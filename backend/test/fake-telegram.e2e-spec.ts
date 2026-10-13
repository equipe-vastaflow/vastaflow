import { ConfigService } from '@nestjs/config';
import {
  TelegramApiClient,
  TelegramApiError,
} from '../src/modules/integrations/telegram/telegram-api.client';
import { startFakeBotApi, type FakeBotApi } from './fake-telegram/fake-bot-api';

const TOKEN = '999000111:AAFAKEfake_apenas_para_testes';

/** O Bot API falso, usado pelo cliente REAL: prova que o falso respeita o que o cliente exige. */
describe('Bot API falso (contrato com o TelegramApiClient)', () => {
  let fake: FakeBotApi;
  let base: string;
  let client: TelegramApiClient;

  const control = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const r = await fetch(`${base}/__control/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await r.json()) as Record<string, unknown>;
  };

  beforeAll(async () => {
    fake = await startFakeBotApi({ port: 0, host: '127.0.0.1', token: TOKEN });
    base = `http://127.0.0.1:${String(fake.port)}`;
    client = new TelegramApiClient(
      new ConfigService({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE_URL: base }),
    );
  });

  afterAll(async () => {
    await fake.close();
  });

  beforeEach(async () => {
    await control('reset', {});
  });

  it('getMe: o cliente aceita a resposta como a de um bot', async () => {
    await expect(client.getMe()).resolves.toBeUndefined();
  });

  it('getUpdates: devolve a fila e o offset CONFIRMA (descarta o que veio antes)', async () => {
    await control('enqueue', {
      updates: [
        { update_id: 10, message: {} },
        { update_id: 11, message: {} },
      ],
    });

    const primeira = await client.getUpdates(undefined);
    expect(primeira.map((u) => (u as { update_id: number }).update_id)).toEqual([10, 11]);

    const segunda = await client.getUpdates(11);
    expect(segunda.map((u) => (u as { update_id: number }).update_id)).toEqual([11]);

    expect(await client.getUpdates(12, AbortSignal.timeout(300)).catch(() => 'abortado')).toBe(
      'abortado',
    );
  });

  it('long polling: espera e RESPONDE assim que chega um update', async () => {
    const pendente = client.getUpdates(undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await control('enqueue', { update: { update_id: 77, message: {} } });

    const lote = await pendente;

    expect(lote.map((u) => (u as { update_id: number }).update_id)).toEqual([77]);
  });

  it('dois getUpdates simultaneos: o mais antigo recebe 409 (como no Telegram) e o conflito e contado', async () => {
    const velho = client.getUpdates(undefined);
    const rejeicao = velho.then(
      () => null,
      (e: unknown) => e,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const novo = client.getUpdates(undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const erro = await rejeicao;
    expect(erro).toBeInstanceOf(TelegramApiError);
    expect((erro as TelegramApiError).httpStatus).toBe(409);
    expect((await control('state')).conflicts).toBe(1);

    await control('enqueue', { update: { update_id: 1, message: {} } });
    await novo;
  });

  it('sendMessage: registra chat e texto; texto vazio e recusado', async () => {
    await client.sendMessage('123', 'ola');

    expect((await control('sent')).sent).toEqual([
      expect.objectContaining({ chat_id: '123', text: 'ola' }),
    ]);
    await expect(client.sendMessage('123', '')).rejects.toBeInstanceOf(TelegramApiError);
  });

  it('token errado: 401, e nada e registrado', async () => {
    const intruso = new TelegramApiClient(
      new ConfigService({ TELEGRAM_BOT_TOKEN: '1:outro', TELEGRAM_API_BASE_URL: base }),
    );

    await expect(intruso.sendMessage('1', 'x')).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 401,
    });
    expect((await control('state')).rejectedToken).toBe(1);
    expect((await control('sent')).sent).toEqual([]);
  });

  it('redeliver: re-entrega um update ja visto (queda e reinicio)', async () => {
    await control('enqueue', { update: { update_id: 5, message: {} } });
    await client.getUpdates(undefined);
    await client.getUpdates(6, AbortSignal.timeout(200)).catch(() => undefined);

    await control('redeliver', { update_id: 5 });

    expect(
      (await client.getUpdates(undefined)).map((u) => (u as { update_id: number }).update_id),
    ).toEqual([5]);
  });
});
