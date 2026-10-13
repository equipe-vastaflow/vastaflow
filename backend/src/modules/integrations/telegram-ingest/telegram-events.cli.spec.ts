import { run, type EventsCliDeps, type EventsStore } from './telegram-events.cli';
import { EVENT_RETENTION_MIN_DAYS, STUCK_AFTER_MS } from './telegram-events.policy';
import type { TelegramInboundEvent } from './telegram-inbound-event.entity';

const AGORA = new Date('2026-10-13T12:00:00Z');
const ID = '123e4567-e89b-42d3-a456-426614174000';

interface Fns {
  countByStatus: jest.Mock<Promise<Record<string, number>>, []>;
  findStuck: jest.Mock<Promise<TelegramInboundEvent[]>, [Date, number?]>;
  abandon: jest.Mock<Promise<boolean>, [string, Date]>;
  purgeTerminalBefore: jest.Mock<Promise<number>, [Date]>;
  countTerminalBefore: jest.Mock<Promise<number>, [Date]>;
}

function montar(over: Partial<Fns> = {}): {
  deps: EventsCliDeps;
  store: Fns;
  saida: string[];
  erros: string[];
  auditorias: Array<Record<string, string | number>>;
} {
  const store: Fns = {
    countByStatus: jest.fn(() => Promise.resolve({ CONCLUIDO: 5, PROCESSANDO: 1 })),
    findStuck: jest.fn((_olderThan: Date, _limit?: number) =>
      Promise.resolve([] as TelegramInboundEvent[]),
    ),
    abandon: jest.fn((_id: string, _olderThan: Date) => Promise.resolve(true)),
    purgeTerminalBefore: jest.fn((_before: Date) => Promise.resolve(3)),
    countTerminalBefore: jest.fn((_before: Date) => Promise.resolve(3)),
    ...over,
  };
  const saida: string[] = [];
  const erros: string[] = [];
  const auditorias: Array<Record<string, string | number>> = [];
  const asStore: EventsStore = store;
  return {
    store,
    saida,
    erros,
    auditorias,
    deps: {
      store: asStore,
      now: () => AGORA,
      out: (t) => saida.push(t),
      err: (t) => erros.push(t),
      audit: (m) => {
        auditorias.push(m);
        return Promise.resolve();
      },
    },
  };
}

describe('telegram-events CLI', () => {
  describe('report (so leitura)', () => {
    it('mostra a contagem por status e os eventos presos, sem conteudo', async () => {
      const preso = {
        id: ID,
        updateId: 4242,
        createdAt: new Date(AGORA.getTime() - 40 * 60000),
      } as TelegramInboundEvent;
      const m = montar({ findStuck: jest.fn((_d: Date, _l?: number) => Promise.resolve([preso])) });

      expect(await run(['report'], m.deps)).toBe(0);

      const texto = m.saida.join('\n');
      expect(texto).toContain('CONCLUIDO');
      expect(texto).toContain(`${ID}  update=4242  ha 40 min`);
      expect(m.store.abandon).not.toHaveBeenCalled();
      expect(m.store.purgeTerminalBefore).not.toHaveBeenCalled();
      expect(m.auditorias).toEqual([]);
    });

    it('considera preso o que passou de STUCK_AFTER_MS', async () => {
      const m = montar();

      await run(['report'], m.deps);

      const limite = m.store.findStuck.mock.calls[0]?.[0] ?? new Date(0);
      expect(AGORA.getTime() - limite.getTime()).toBe(STUCK_AFTER_MS);
    });
  });

  describe('abandon (nunca reexecuta)', () => {
    it('encerra um evento preso, audita e avisa que o update NAO sera executado', async () => {
      const m = montar();

      expect(await run(['abandon', '--id', ID], m.deps)).toBe(0);

      expect(m.store.abandon).toHaveBeenCalledWith(ID, new Date(AGORA.getTime() - STUCK_AFTER_MS));
      expect(m.auditorias).toEqual([{ operacao: 'abandonar', eventoId: ID }]);
      expect(m.saida.join('\n')).toContain('NAO sera executado');
    });

    it('evento que nao esta preso (ou nao existe): recusa e nao audita', async () => {
      const m = montar({ abandon: jest.fn((_i: string, _d: Date) => Promise.resolve(false)) });

      expect(await run(['abandon', '--id', ID], m.deps)).toBe(1);
      expect(m.auditorias).toEqual([]);
      expect(m.erros.join('\n')).toContain('nada feito');
    });

    it.each([[['abandon']], [['abandon', '--id', 'x']], [['abandon', '--id', "1' OR '1'='1"]]])(
      'id invalido (%j): uso, sem tocar o banco',
      async (argv) => {
        const m = montar();

        expect(await run(argv, m.deps)).toBe(1);
        expect(m.store.abandon).not.toHaveBeenCalled();
      },
    );
  });

  describe('purge (retencao com piso)', () => {
    it('sem --yes so simula', async () => {
      const m = montar();

      expect(await run(['purge', '--older-than-days', '30'], m.deps)).toBe(0);

      expect(m.store.countTerminalBefore).toHaveBeenCalled();
      expect(m.store.purgeTerminalBefore).not.toHaveBeenCalled();
      expect(m.saida.join('\n')).toContain('simulacao');
      expect(m.auditorias).toEqual([]);
    });

    it('com --yes apaga os terminais antigos e audita a quantidade', async () => {
      const m = montar();

      expect(await run(['purge', '--older-than-days', '30', '--yes'], m.deps)).toBe(0);

      const corte = m.store.purgeTerminalBefore.mock.calls[0]?.[0] ?? new Date(0);
      expect(AGORA.getTime() - corte.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
      expect(m.auditorias).toEqual([{ operacao: 'limpar', quantidade: 3, dias: 30 }]);
    });

    it(`o piso e de ${String(EVENT_RETENTION_MIN_DAYS)} dias: menos que isso e recusado (reabriria updates ja vistos)`, async () => {
      for (const dias of ['0', '1', String(EVENT_RETENTION_MIN_DAYS - 1), '-5', 'abc', '7.5']) {
        const m = montar();

        expect(await run(['purge', '--older-than-days', dias, '--yes'], m.deps)).toBe(1);
        expect(m.store.purgeTerminalBefore).not.toHaveBeenCalled();
      }
    });

    it('o piso exato e aceito', async () => {
      const m = montar();

      expect(
        await run(
          ['purge', '--older-than-days', String(EVENT_RETENTION_MIN_DAYS), '--yes'],
          m.deps,
        ),
      ).toBe(0);
    });

    it('a retencao minima cobre com folga o reenvio de 24 h do Telegram', () => {
      expect(EVENT_RETENTION_MIN_DAYS * 24).toBeGreaterThan(24);
    });
  });

  it.each([[[]], [['faz-tudo']], [['report', '--sql', 'x']], [['purge', '--force']]])(
    'uso invalido (%j): codigo 1 e nada executado',
    async (argv) => {
      const m = montar();

      expect(await run(argv, m.deps)).toBe(1);
      expect(m.store.purgeTerminalBefore).not.toHaveBeenCalled();
      expect(m.store.abandon).not.toHaveBeenCalled();
    },
  );

  it('falha do banco: codigo 1 e sem detalhe interno', async () => {
    const m = montar({ countByStatus: jest.fn(() => Promise.reject(new Error('senha=SEGREDO'))) });

    expect(await run(['report'], m.deps)).toBe(1);
    expect(m.erros.join('\n')).not.toContain('x'.repeat(0) + 'zzzz');
  });
});
