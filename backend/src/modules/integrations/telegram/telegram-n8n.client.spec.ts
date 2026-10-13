import { ConfigService } from '@nestjs/config';
import type { TelegramEnvelope } from './telegram-envelope';
import {
  N8N_DELIVERY_TIMEOUT_MS,
  TelegramN8nClient,
  TelegramRelayError,
} from './telegram-n8n.client';

const URL_OK = 'http://n8n:5678/webhook/vastaflow-telegram';

const ENVELOPE: TelegramEnvelope = {
  version: 'v1',
  platform: 'telegram',
  botId: '123456789',
  updateId: 1,
  messageId: 2,
  chatId: '777',
  userId: '777',
  chatType: 'private',
  text: '/ajuda',
  sentAt: 1_790_000_000,
  issuedAt: 1_790_000_005_000,
};

function cliente(url: string | null = URL_OK): TelegramN8nClient {
  return new TelegramN8nClient(
    new ConfigService(url === null ? {} : { TELEGRAM_N8N_WEBHOOK_URL: url }),
  );
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function falhaDe(promessa: Promise<unknown>): Promise<TelegramRelayError> {
  try {
    await promessa;
  } catch (error) {
    expect(error).toBeInstanceOf(TelegramRelayError);
    return error as TelegramRelayError;
  }
  throw new Error('era esperada uma falha');
}

describe('TelegramN8nClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('isConfigured reflete a URL', () => {
    expect(cliente().isConfigured()).toBe(true);
    expect(cliente(null).isConfigured()).toBe(false);
    expect(cliente('').isConfigured()).toBe(false);
  });

  it('sem URL: falha `not-configured` e nenhuma chamada de rede', async () => {
    const erro = await falhaDe(cliente(null).deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('not-configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'http://exemplo.com/webhook/x',
    'http://n8n:5678/rest/login',
    'http://u:p@n8n:5678/webhook/x',
    'http://n8n:5678/webhook/x?a=1',
  ])('URL invalida (%s): nao chama a rede', async (url) => {
    const erro = await falhaDe(cliente(url).deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('not-configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST com JSON {envelope, signature}, sem credencial, sem seguir redirect', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));

    const corpo = await cliente().deliver(ENVELOPE, 'f'.repeat(64));

    expect(corpo).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    expect(String(url)).toBe(URL_OK);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      envelope: ENVELOPE,
      signature: 'f'.repeat(64),
    });
    const cabecalhos = JSON.stringify(init.headers).toLowerCase();
    expect(cabecalhos).not.toContain('authorization');
    expect(cabecalhos).not.toContain('token');
  });

  it('uma unica tentativa: erro de rede nao e repetido', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED n8n:5678'));

    const erro = await falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a mensagem do erro nao traz URL, host nem o erro original', async () => {
    fetchMock.mockRejectedValue(
      new Error('connect ECONNREFUSED n8n:5678 /webhook/vastaflow-telegram'),
    );

    const erro = await falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));

    const tudo = `${erro.message} ${JSON.stringify(erro)} ${erro.stack ?? ''}`;
    expect(tudo).not.toContain('n8n:5678');
    expect(tudo).not.toContain('/webhook');
    expect(tudo).not.toContain('ECONNREFUSED');
  });

  it.each([301, 302, 307, 308])('redirect %i: recusado, nao seguido', async (status) => {
    fetchMock.mockResolvedValue(
      new Response(null, { status, headers: { Location: 'http://evil.example/' } }),
    );

    const erro = await falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('redirect');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([201, 204, 400, 401, 404, 500, 502])('status %i: falha `http`', async (status) => {
    fetchMock.mockResolvedValue(
      new Response(status === 204 ? null : 'corpo do erro SEGREDO', { status }),
    );

    const erro = await falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('http');
    expect(erro.httpStatus).toBe(status);
    expect(erro.message).not.toContain('SEGREDO');
  });

  it.each([
    ['nao e JSON', new Response('<html>', { status: 200 })],
    ['JSON que nao e objeto', json(200, [1, 2])],
    ['JSON null', json(200, null)],
    ['vazio', new Response('', { status: 200 })],
  ])('resposta %s: `invalid-response`', async (_nome, resposta) => {
    fetchMock.mockResolvedValue(resposta);

    const erro = await falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('invalid-response');
  });

  it('corpo acima do teto (declarado): recusado', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }, { 'content-length': String(1024 * 1024) }));

    const erro = await falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('invalid-response');
  });

  it('corpo acima do teto (sem content-length): interrompido', async () => {
    const grande = JSON.stringify({ lixo: 'x'.repeat(70 * 1024) });
    fetchMock.mockResolvedValue(new Response(grande, { status: 200 }));

    const erro = await falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));

    expect(erro.kind).toBe('invalid-response');
  });

  it('tempo esgotado: falha `timeout`', async () => {
    const controle = new AbortController();
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controle.signal);
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );

    const pendente = falhaDe(cliente().deliver(ENVELOPE, 'a'.repeat(64)));
    controle.abort();

    expect((await pendente).kind).toBe('timeout');
    expect(timeoutSpy).toHaveBeenCalledWith(N8N_DELIVERY_TIMEOUT_MS);
  });

  it('o prazo cobre a consulta ao Plantae (20 s) com folga', () => {
    expect(N8N_DELIVERY_TIMEOUT_MS).toBeGreaterThan(20_000);
  });
});
