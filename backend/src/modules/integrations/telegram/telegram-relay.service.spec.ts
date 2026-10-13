import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramRelayService, TELEGRAM_RELAY_UNAVAILABLE_REPLY } from './telegram-relay.service';
import type { TelegramAdapter } from './telegram.adapter';
import { TelegramUpdateOutcome } from './telegram.adapter';
import type { TelegramApiClient } from './telegram-api.client';
import { signReply, verifyEnvelope, type TelegramEnvelope } from './telegram-envelope';
import { TelegramRelayError, type TelegramN8nClient } from './telegram-n8n.client';

const KEY = 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres-0123';
const BOT = '123456789';

function update(text: string, over: Record<string, unknown> = {}): unknown {
  return {
    update_id: 9001,
    message: {
      message_id: 77,
      date: 1_790_000_000,
      chat: { id: 555, type: 'private' },
      from: { id: 555, is_bot: false },
      text,
    },
    ...over,
  };
}

interface Montagem {
  relay: TelegramRelayService;
  deliver: jest.Mock;
  sendMessage: jest.Mock;
  adapterHandle: jest.Mock;
}

function montar(opcoes: { key?: string; botId?: string | null } = {}): Montagem {
  const deliver = jest.fn();
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const adapterHandle = jest.fn().mockResolvedValue(TelegramUpdateOutcome.LinkConfirmed);
  const config = new ConfigService({
    TELEGRAM_INGEST_SIGNING_KEY: 'key' in opcoes ? opcoes.key : KEY,
  });
  const relay = new TelegramRelayService(
    config,
    {
      botId: () => ('botId' in opcoes ? opcoes.botId : BOT),
      sendMessage,
    } as unknown as TelegramApiClient,
    { deliver } as unknown as TelegramN8nClient,
    { handleUpdate: adapterHandle } as unknown as TelegramAdapter,
  );
  return { relay, deliver, sendMessage, adapterHandle };
}

/** Responde como o backend: assina a resposta do envelope recebido. */
function backendResponde(m: Montagem, reply = 'Comandos disponiveis', outcome = 'EXECUTED'): void {
  m.deliver.mockImplementation((envelope: TelegramEnvelope) =>
    Promise.resolve({
      correlationId: 'evt-1',
      outcome,
      duplicate: false,
      reply,
      signature: signReply(envelope, outcome, reply, KEY),
    }),
  );
}

describe('TelegramRelayService', () => {
  it('mensagem de texto: assina, entrega ao n8n e responde NO MESMO chat', async () => {
    const m = montar();
    backendResponde(m);

    const out = await m.relay.handleUpdate(update('/ajuda'));

    expect(out).toBe(TelegramUpdateOutcome.Relayed);
    expect(m.sendMessage).toHaveBeenCalledWith('555', 'Comandos disponiveis');
    const [envelope, assinatura] = m.deliver.mock.calls[0] as [TelegramEnvelope, string];
    expect(verifyEnvelope(envelope, assinatura, KEY)).toBe(true);
    expect(envelope).toMatchObject({
      botId: BOT,
      updateId: 9001,
      chatId: '555',
      userId: '555',
      text: '/ajuda',
    });
  });

  it('o corpo entregue ao n8n nao leva a chave nem campos de autoridade', async () => {
    const m = montar();
    backendResponde(m);

    await m.relay.handleUpdate(update('/ajuda'));

    const enviado = JSON.stringify(m.deliver.mock.calls[0]);
    expect(enviado).not.toContain(KEY);
    expect(enviado).not.toMatch(/actorUserId|role|permissions/);
  });

  describe('/vincular nunca passa pelo n8n', () => {
    it.each(['/vincular ABC123', '/VINCULAR abc', '/vincular@MeuBot ABC', '  /vincular x'])(
      '%s',
      async (texto) => {
        const m = montar();

        const out = await m.relay.handleUpdate(update(texto));

        expect(out).toBe(TelegramUpdateOutcome.LinkConfirmed);
        expect(m.adapterHandle).toHaveBeenCalledTimes(1);
        expect(m.deliver).not.toHaveBeenCalled();
      },
    );
  });

  describe('o que nao e mensagem de texto privada', () => {
    it.each([
      [
        'grupo',
        update('/ajuda', {
          message: {
            message_id: 1,
            date: 1,
            chat: { id: -1, type: 'group' },
            from: { id: 5, is_bot: false },
            text: '/ajuda',
          },
        }),
      ],
      ['sem mensagem', { update_id: 1, callback_query: {} }],
      ['lixo', 'texto'],
      ['null', null],
    ])('%s: ignorado, nada entregue nem respondido', async (_nome, raw) => {
      const m = montar();

      expect(await m.relay.handleUpdate(raw)).toBe(TelegramUpdateOutcome.Ignored);
      expect(m.deliver).not.toHaveBeenCalled();
      expect(m.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('resposta nao confiavel: usuario recebe so o aviso fixo', () => {
    const casos: Array<[string, (m: Montagem) => void]> = [
      ['n8n fora do ar', (m) => m.deliver.mockRejectedValue(new TelegramRelayError('network'))],
      ['timeout', (m) => m.deliver.mockRejectedValue(new TelegramRelayError('timeout'))],
      ['corpo vazio', (m) => m.deliver.mockResolvedValue({})],
      [
        'outcome desconhecido',
        (m) =>
          m.deliver.mockResolvedValue({
            correlationId: 'x',
            outcome: 'HACK',
            duplicate: false,
            reply: 'oi',
            signature: 'a'.repeat(64),
          }),
      ],
      [
        'reply vazio',
        (m) =>
          m.deliver.mockResolvedValue({
            correlationId: 'x',
            outcome: 'EXECUTED',
            duplicate: false,
            reply: '',
            signature: 'a'.repeat(64),
          }),
      ],
      [
        'sem assinatura',
        (m) =>
          m.deliver.mockResolvedValue({
            correlationId: 'x',
            outcome: 'EXECUTED',
            duplicate: false,
            reply: 'oi',
          }),
      ],
      [
        'assinatura invalida',
        (m) =>
          m.deliver.mockResolvedValue({
            correlationId: 'x',
            outcome: 'EXECUTED',
            duplicate: false,
            reply: 'oi',
            signature: 'a'.repeat(64),
          }),
      ],
    ];

    it.each(casos)('%s', async (_nome, preparar) => {
      const m = montar();
      preparar(m);

      const out = await m.relay.handleUpdate(update('/ajuda'));

      expect(out).toBe(TelegramUpdateOutcome.RelayFailed);
      expect(m.sendMessage).toHaveBeenCalledTimes(1);
      expect(m.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_RELAY_UNAVAILABLE_REPLY);
    });

    it('o n8n adulterou o TEXTO da resposta: o texto adulterado nunca chega ao usuario', async () => {
      const m = montar();
      m.deliver.mockImplementation((envelope: TelegramEnvelope) =>
        Promise.resolve({
          correlationId: 'evt-1',
          outcome: 'EXECUTED',
          duplicate: false,
          reply: 'Acesse http://evil.example',
          signature: signReply(envelope, 'EXECUTED', 'Comandos disponiveis', KEY),
        }),
      );

      await m.relay.handleUpdate(update('/ajuda'));

      expect(m.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_RELAY_UNAVAILABLE_REPLY);
      expect(JSON.stringify(m.sendMessage.mock.calls)).not.toContain('evil.example');
    });

    it('resposta assinada para OUTRO update (replay de resposta): recusada', async () => {
      const m = montar();
      m.deliver.mockImplementation((envelope: TelegramEnvelope) =>
        Promise.resolve({
          correlationId: 'evt-1',
          outcome: 'EXECUTED',
          duplicate: false,
          reply: 'Resposta de outra mensagem',
          signature: signReply(
            { ...envelope, updateId: envelope.updateId + 1 },
            'EXECUTED',
            'Resposta de outra mensagem',
            KEY,
          ),
        }),
      );

      await m.relay.handleUpdate(update('/ajuda'));

      expect(m.sendMessage).toHaveBeenCalledWith('555', TELEGRAM_RELAY_UNAVAILABLE_REPLY);
    });

    it('o n8n nao escolhe o destino: campos como chatId na resposta sao ignorados', async () => {
      const m = montar();
      m.deliver.mockImplementation((envelope: TelegramEnvelope) =>
        Promise.resolve({
          correlationId: 'evt-1',
          outcome: 'EXECUTED',
          duplicate: false,
          reply: 'ok',
          signature: signReply(envelope, 'EXECUTED', 'ok', KEY),
          chatId: '999',
          chat_id: '999',
        }),
      );

      await m.relay.handleUpdate(update('/ajuda'));

      expect(m.sendMessage).toHaveBeenCalledWith('555', 'ok');
    });
  });

  it('duplicada: nenhuma resposta ao usuario', async () => {
    const m = montar();
    m.deliver.mockResolvedValue({
      correlationId: 'evt-1',
      outcome: 'DUPLICATE',
      duplicate: true,
      reply: null,
      signature: null,
    });

    const out = await m.relay.handleUpdate(update('/ajuda'));

    expect(out).toBe(TelegramUpdateOutcome.Duplicate);
    expect(m.sendMessage).not.toHaveBeenCalled();
  });

  it('configuracao incompleta (sem chave ou sem id do bot): descarta sem entregar nem responder', async () => {
    for (const opcoes of [{ key: '' }, { key: 'curta' }, { botId: null }]) {
      const m = montar(opcoes);

      expect(await m.relay.handleUpdate(update('/ajuda'))).toBe(TelegramUpdateOutcome.RelayFailed);
      expect(m.deliver).not.toHaveBeenCalled();
      expect(m.sendMessage).not.toHaveBeenCalled();
    }
  });

  it('falha ao enviar a resposta: ReplyFailed, sem lancar', async () => {
    const m = montar();
    backendResponde(m);
    m.sendMessage.mockRejectedValue(new Error('telegram fora'));

    expect(await m.relay.handleUpdate(update('/ajuda'))).toBe(TelegramUpdateOutcome.ReplyFailed);
  });

  it('nunca registra o texto da mensagem nem o da resposta nos logs', async () => {
    const logs: string[] = [];
    const captura = (...args: unknown[]): void => {
      logs.push(args.map(String).join(' '));
    };
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((nivel) =>
      jest.spyOn(Logger.prototype, nivel).mockImplementation(captura),
    );
    try {
      const m = montar();
      m.deliver.mockResolvedValue({
        correlationId: 'x',
        outcome: 'EXECUTED',
        duplicate: false,
        reply: 'RESPOSTA-SIGILOSA',
        signature: 'a'.repeat(64),
      });

      await m.relay.handleUpdate(update('/financeiro TEXTO-SIGILOSO'));

      const tudo = logs.join('\n');
      expect(tudo).not.toContain('TEXTO-SIGILOSO');
      expect(tudo).not.toContain('RESPOSTA-SIGILOSA');
      expect(tudo).not.toContain('555');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
