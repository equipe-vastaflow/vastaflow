import { SlidingWindowLimiter } from './sliding-window-limiter';

function relogio(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('SlidingWindowLimiter', () => {
  it('aceita ate o limite e recusa o excesso', () => {
    const r = relogio();
    const limiter = new SlidingWindowLimiter(3, 60_000, 100, r.now);

    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true]);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('a janela DESLIZA: a vaga volta quando a tentativa mais antiga sai da janela', () => {
    const r = relogio();
    const limiter = new SlidingWindowLimiter(2, 60_000, 100, r.now);
    limiter.take('a');
    r.advance(30_000);
    limiter.take('a');

    expect(limiter.take('a').allowed).toBe(false);
    r.advance(30_001);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('informa quanto falta ate a proxima vaga', () => {
    const r = relogio();
    const limiter = new SlidingWindowLimiter(1, 60_000, 100, r.now);
    limiter.take('a');
    r.advance(20_000);

    expect(limiter.take('a').retryAfterMs).toBe(40_000);
  });

  it('so a PRIMEIRA recusa da janela pede aviso; as seguintes sao silenciosas', () => {
    const r = relogio();
    const limiter = new SlidingWindowLimiter(1, 60_000, 100, r.now);
    limiter.take('a');

    expect(limiter.take('a').firstRejection).toBe(true);
    expect(limiter.take('a').firstRejection).toBe(false);
    expect(limiter.take('a').firstRejection).toBe(false);
    r.advance(60_001);
    limiter.take('a');
    expect(limiter.take('a').firstRejection).toBe(true);
  });

  describe('isolamento: uma identidade nao bloqueia as outras', () => {
    it('esgotar a cota de A nao toca a de B', () => {
      const limiter = new SlidingWindowLimiter(2, 60_000);
      for (let i = 0; i < 50; i += 1) {
        limiter.take('a');
      }

      expect(limiter.take('a').allowed).toBe(false);
      expect(limiter.take('b').allowed).toBe(true);
      expect(limiter.take('b').allowed).toBe(true);
    });
  });

  describe('memoria limitada', () => {
    it('nunca guarda mais chaves que o maximo, mesmo sob enxurrada de ids', () => {
      const limiter = new SlidingWindowLimiter(1, 60_000, 50);
      for (let i = 0; i < 5_000; i += 1) {
        limiter.take(`id-${String(i)}`);
      }

      expect(limiter.size()).toBeLessThanOrEqual(50);
    });

    it('janelas vencidas saem primeiro; quem esta ativo e preservado', () => {
      const r = relogio();
      const limiter = new SlidingWindowLimiter(1, 60_000, 3, r.now);
      limiter.take('velha1');
      limiter.take('velha2');
      r.advance(61_000);
      limiter.take('ativa');
      limiter.take('nova1');

      expect(limiter.take('ativa').allowed).toBe(false);
    });
  });

  it.each([
    [0, 1000],
    [-1, 1000],
    [1.5, 1000],
    [1, 0],
  ])('parametros invalidos (limite %p, janela %p) lancam', (limit, window) => {
    expect(() => new SlidingWindowLimiter(limit, window)).toThrow(RangeError);
  });
});
