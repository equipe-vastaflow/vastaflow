import { signReply, verifyEnvelope, type TelegramEnvelope } from './telegram-envelope';
import { TelegramRelayError } from './telegram-n8n.client';
import { run, SIMULATED_BOT_ID, type SimulatorIo } from './telegram-simulate.cli';

const KEY = 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres-0123';
const ENV = {
  TELEGRAM_INGEST_SIGNING_KEY: KEY,
  TELEGRAM_N8N_WEBHOOK_URL: 'http://n8n:5678/webhook/x',
};
const AGORA = 1_790_000_005_000;

function io(): SimulatorIo & { saida: string[]; erros: string[] } {
  const saida: string[] = [];
  const erros: string[] = [];
  return {
    saida,
    erros,
    out: (t) => saida.push(t),
    err: (t) => erros.push(t),
  };
}

describe('telegram-simulate CLI', () => {
  it('monta um envelope de chat privado, assina, entrega e mostra a resposta conferida', async () => {
    const saida = io();
    let visto: { envelope: TelegramEnvelope; assinatura: string } | null = null;
    const deliver = jest.fn((envelope: TelegramEnvelope, assinatura: string) => {
      visto = { envelope, assinatura };
      return Promise.resolve({
        correlationId: 'c1',
        outcome: 'EXECUTED',
        duplicate: false,
        reply: 'Comandos disponiveis',
        signature: signReply(envelope, 'EXECUTED', 'Comandos disponiveis', KEY),
      });
    });

    const code = await run(['--user', '123', '--text', '/ajuda'], ENV, {
      io: saida,
      now: () => AGORA,
      deliver,
    });

    expect(code).toBe(0);
    expect(visto).not.toBeNull();
    const { envelope, assinatura } = visto as unknown as {
      envelope: TelegramEnvelope;
      assinatura: string;
    };
    expect(envelope).toMatchObject({
      botId: SIMULATED_BOT_ID,
      chatId: '123',
      userId: '123',
      chatType: 'private',
      text: '/ajuda',
      issuedAt: AGORA,
    });
    expect(verifyEnvelope(envelope, assinatura, KEY)).toBe(true);
    expect(saida.saida.join('\n')).toContain('assinatura da resposta: valida');
    expect(saida.saida.join('\n')).toContain('Comandos disponiveis');
  });

  it('o bot simulado nao e um bot real (nunca colide com updates de verdade)', () => {
    expect(SIMULATED_BOT_ID).toBe('999000111');
  });

  it('resposta com assinatura errada: INVALIDA, codigo 3 e o texto NAO e exibido', async () => {
    const saida = io();

    const code = await run(['--user', '123', '--text', '/ajuda'], ENV, {
      io: saida,
      now: () => AGORA,
      deliver: () =>
        Promise.resolve({
          correlationId: 'c1',
          outcome: 'EXECUTED',
          duplicate: false,
          reply: 'TEXTO-ADULTERADO',
          signature: 'a'.repeat(64),
        }),
    });

    expect(code).toBe(3);
    expect(saida.saida.join('\n')).toContain('INVALIDA');
    expect(saida.saida.join('\n')).not.toContain('TEXTO-ADULTERADO');
  });

  it('duplicada: informa, sem resposta', async () => {
    const saida = io();

    const code = await run(['--user', '123', '--text', '/ajuda', '--update-id', '77'], ENV, {
      io: saida,
      now: () => AGORA,
      deliver: () =>
        Promise.resolve({
          correlationId: 'c',
          outcome: 'DUPLICATE',
          duplicate: true,
          reply: null,
          signature: null,
        }),
    });

    expect(code).toBe(0);
    expect(saida.saida.join('\n')).toContain('duplicada: sim');
  });

  it('--update-id repetido gera o mesmo update (para provar a idempotencia)', async () => {
    const ids: number[] = [];
    const deliver = (e: TelegramEnvelope): Promise<unknown> => {
      ids.push(e.updateId);
      return Promise.resolve({});
    };

    await run(['--user', '1', '--text', 'a', '--update-id', '42'], ENV, { io: io(), deliver });
    await run(['--user', '1', '--text', 'b', '--update-id', '42'], ENV, { io: io(), deliver });

    expect(ids).toEqual([42, 42]);
  });

  it('falha de entrega: codigo 2 e so a categoria (sem URL)', async () => {
    const saida = io();

    const code = await run(['--user', '1', '--text', 'a'], ENV, {
      io: saida,
      deliver: () => Promise.reject(new TelegramRelayError('network')),
    });

    expect(code).toBe(2);
    expect(saida.erros.join('\n')).toContain('network');
    expect(saida.erros.join('\n')).not.toContain('n8n:5678');
  });

  it('--dry-run nao entrega e nao imprime a chave', async () => {
    const saida = io();
    const deliver = jest.fn();

    const code = await run(['--user', '1', '--text', '/ajuda', '--dry-run'], ENV, {
      io: saida,
      now: () => AGORA,
      deliver,
    });

    expect(code).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(saida.saida.join('\n')).not.toContain(KEY);
  });

  it.each([
    ['sem --user', ['--text', 'a']],
    ['sem --text', ['--user', '1']],
    ['user nao numerico', ['--user', 'abc', '--text', 'a']],
    ['texto vazio', ['--user', '1', '--text', '  ']],
    ['argumento desconhecido', ['--user', '1', '--text', 'a', '--role', 'ADMIN']],
    ['flag sem valor', ['--user']],
  ])('uso invalido (%s): codigo 1, nada entregue', async (_nome, argv) => {
    const deliver = jest.fn();
    const saida = io();

    expect(await run(argv, ENV, { io: saida, deliver })).toBe(1);
    expect(deliver).not.toHaveBeenCalled();
    expect(saida.erros.length).toBeGreaterThan(0);
  });

  it.each([{}, { TELEGRAM_INGEST_SIGNING_KEY: 'SEGREDO-X1' }])(
    'sem chave utilizavel (%p): codigo 1 e a chave nunca e ecoada',
    async (env) => {
      const saida = io();

      expect(
        await run(['--user', '1', '--text', 'a'], env, { io: saida, deliver: jest.fn() }),
      ).toBe(1);
      expect(saida.erros.join('\n')).not.toContain('SEGREDO-X1');
    },
  );

  it('nao existe forma de informar usuario interno, perfil ou permissao', async () => {
    for (const flag of ['--actor-user-id', '--role', '--permissions', '--usuario-id']) {
      const deliver = jest.fn();

      expect(await run(['--user', '1', '--text', 'a', flag, 'x'], ENV, { io: io(), deliver })).toBe(
        1,
      );
      expect(deliver).not.toHaveBeenCalled();
    }
  });
});
