import { ConfigService } from '@nestjs/config';
import {
  TELEGRAM_LONG_POLL_SECONDS,
  TELEGRAM_POLL_REQUEST_TIMEOUT_MS,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TelegramApiClient,
  TelegramApiError,
} from './telegram-api.client';

/** Texto FALSO, so para provar que ele nunca vaza. Nao e um token do Telegram. */
const TOKEN_FALSO = 'TOKEN-FALSO-DE-TESTE-nao-e-token-real';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** `null` = sem a chave no ambiente. (`undefined` acionaria o valor padrao.) */
function cliente(token: string | null = TOKEN_FALSO): TelegramApiClient {
  return new TelegramApiClient(
    new ConfigService(token === null ? {} : { TELEGRAM_BOT_TOKEN: token }),
  );
}

/** Tudo o que um erro expoe: mensagem, propriedades e causa. */
function tudoDoErro(error: unknown): string {
  const e = error as Error & { cause?: unknown };
  return `${e.message} ${JSON.stringify(e)} ${String(e.cause)} ${e.stack ?? ''}`;
}

async function falhaDe(promessa: Promise<unknown>): Promise<TelegramApiError> {
  try {
    await promessa;
  } catch (error) {
    expect(error).toBeInstanceOf(TelegramApiError);
    return error as TelegramApiError;
  }
  throw new Error('era esperada uma falha');
}

describe('TelegramApiClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sem configuracao', () => {
    it.each([
      ['ausente', null],
      ['vazio', ''],
      ['so espacos', '   '],
    ])('token %s: nao configurado e nenhuma chamada de rede', async (_caso, token) => {
      const client = cliente(token);

      expect(client.isConfigured()).toBe(false);
      expect((await falhaDe(client.getMe())).kind).toBe('not-configured');
      expect((await falhaDe(client.getUpdates(undefined))).kind).toBe('not-configured');
      expect((await falhaDe(client.sendMessage('1', 'oi'))).kind).toBe('not-configured');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('com token: configurado, sem chamar a rede para saber disso', () => {
      expect(cliente().isConfigured()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('chamada', () => {
    it('getMe: POST JSON no metodo oficial da Bot API', async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, result: { id: 1, is_bot: true } }));

      await cliente().getMe();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://api.telegram.org/bot${TOKEN_FALSO}/getMe`);
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('getMe: resultado que nao e de um bot e resposta invalida', async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, result: { id: 1, is_bot: false } }));

      expect((await falhaDe(cliente().getMe())).kind).toBe('invalid-response');
    });

    it('getUpdates: offset, long polling e somente mensagens', async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, result: [] }));

      await cliente().getUpdates(42);

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as unknown;
      expect(body).toEqual({
        offset: 42,
        timeout: TELEGRAM_LONG_POLL_SECONDS,
        allowed_updates: ['message'],
      });
    });

    it('getUpdates sem offset nao envia o campo', async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, result: [] }));

      await cliente().getUpdates(undefined);

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as object;
      expect(body).not.toHaveProperty('offset');
    });

    it('getUpdates: resultado que nao e lista e resposta invalida', async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, result: { update_id: 1 } }));

      expect((await falhaDe(cliente().getUpdates(undefined))).kind).toBe('invalid-response');
    });

    it('sendMessage: so chat_id e texto, sem parse_mode', async () => {
      fetchMock.mockResolvedValue(json(200, { ok: true, result: { message_id: 1 } }));

      await cliente().sendMessage('4242', 'Resposta *sem* marcacao');

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as unknown;
      expect(body).toEqual({ chat_id: '4242', text: 'Resposta *sem* marcacao' });
    });
  });

  describe('timeout explicito', () => {
    /** Substitui o timer do `AbortSignal.timeout` por um controle manual. */
    function controlarTimeout(): { disparar: () => void; pedidos: number[] } {
      const controles: AbortController[] = [];
      const pedidos: number[] = [];
      jest.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
        pedidos.push(ms);
        const controle = new AbortController();
        controles.push(controle);
        return controle.signal;
      });
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('This operation was aborted', 'TimeoutError'));
            });
          }),
      );
      return {
        disparar: () => {
          controles.forEach((c) => {
            c.abort();
          });
        },
        pedidos,
      };
    }

    it('chamada comum usa o limite padrao e vira timeout ao estourar', async () => {
      const timeout = controlarTimeout();

      const chamada = cliente().getMe();
      timeout.disparar();

      expect((await falhaDe(chamada)).kind).toBe('timeout');
      expect(timeout.pedidos).toEqual([TELEGRAM_REQUEST_TIMEOUT_MS]);
    });

    it('getUpdates usa o limite do long polling, maior que a espera pedida', async () => {
      const timeout = controlarTimeout();

      const chamada = cliente().getUpdates(undefined);
      timeout.disparar();

      expect((await falhaDe(chamada)).kind).toBe('timeout');
      expect(timeout.pedidos).toEqual([TELEGRAM_POLL_REQUEST_TIMEOUT_MS]);
      expect(TELEGRAM_POLL_REQUEST_TIMEOUT_MS).toBeGreaterThan(TELEGRAM_LONG_POLL_SECONDS * 1000);
    });

    it('interrupcao pelo chamador (shutdown) vira aborted, nao timeout', async () => {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('This operation was aborted', 'AbortError'));
            });
          }),
      );
      const controle = new AbortController();

      const chamada = cliente().getUpdates(undefined, controle.signal);
      controle.abort();

      expect((await falhaDe(chamada)).kind).toBe('aborted');
    });
  });

  describe('falhas', () => {
    it('erro HTTP: status preservado, descricao do Telegram descartada', async () => {
      fetchMock.mockResolvedValue(
        json(401, { ok: false, error_code: 401, description: 'Unauthorized' }),
      );

      const erro = await falhaDe(cliente().getMe());

      expect(erro.kind).toBe('http');
      expect(erro.httpStatus).toBe(401);
      expect(erro.message).not.toContain('Unauthorized');
    });

    it('erro HTTP com corpo que nao e JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));

      const erro = await falhaDe(cliente().getMe());

      expect(erro).toMatchObject({ kind: 'http', httpStatus: 502 });
    });

    it('200 com corpo que nao e JSON: resposta invalida', async () => {
      fetchMock.mockResolvedValue(new Response('nao e json', { status: 200 }));

      expect((await falhaDe(cliente().getMe())).kind).toBe('invalid-response');
    });

    it.each([
      ['sem o campo ok', { result: {} }],
      ['ok nao booleano', { ok: 'true', result: {} }],
      ['ok sem result', { ok: true }],
      ['lista no lugar do objeto', [1, 2]],
    ])('resposta invalida: %s', async (_caso, corpo) => {
      fetchMock.mockResolvedValue(json(200, corpo));

      expect((await falhaDe(cliente().getMe())).kind).toBe('invalid-response');
    });

    it('ok: false com 200 e erro da API', async () => {
      fetchMock.mockResolvedValue(json(200, { ok: false, description: 'algo' }));

      expect((await falhaDe(cliente().getMe())).kind).toBe('api');
    });

    it('erro de rede: categoria fixa, sem a mensagem original', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed: ECONNRESET'));

      const erro = await falhaDe(cliente().getMe());

      expect(erro.kind).toBe('network');
      expect(erro.message).not.toContain('ECONNRESET');
    });
  });

  describe('token nunca vaza', () => {
    it.each([
      [
        'rede, com a URL na mensagem',
        () => {
          fetchMock.mockRejectedValue(
            new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN_FALSO}/getMe`),
          );
        },
      ],
      [
        'HTTP',
        () => {
          fetchMock.mockResolvedValue(json(404, { ok: false, description: `bot${TOKEN_FALSO}` }));
        },
      ],
      [
        'resposta invalida',
        () => {
          fetchMock.mockResolvedValue(json(200, { ok: true, result: TOKEN_FALSO }));
        },
      ],
    ])('falha de %s: o erro nao carrega token, URL nem causa', async (_caso, preparar) => {
      preparar();

      const erro = await falhaDe(cliente().getMe());

      expect(tudoDoErro(erro)).not.toContain(TOKEN_FALSO);
      expect(tudoDoErro(erro)).not.toContain('api.telegram.org');
      expect((erro as Error & { cause?: unknown }).cause).toBeUndefined();
    });
  });
});
