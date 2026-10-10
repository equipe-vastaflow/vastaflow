import { PlantaeApiError } from './plantae-errors';
import { PlantaeRateLimiter } from './plantae-rate-limiter';

/** Relogio falso: `sleep` anda no tempo sem esperar de verdade. */
function clock(): { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: (ms) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

async function falha(promise: Promise<unknown>): Promise<PlantaeApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PlantaeApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('deveria ter falhado');
}

describe('PlantaeRateLimiter: janela deslizante', () => {
  it('libera ate o maximo sem esperar', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({
      maxRequests: 3,
      windowMs: 1000,
      maxConcurrent: 10,
      ...c,
    });

    for (let i = 0; i < 3; i += 1) {
      (await limiter.acquire())();
    }

    expect(c.sleeps).toEqual([]);
  });

  it('a requisicao seguinte ESPERA o fim da janela', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({
      maxRequests: 3,
      windowMs: 1000,
      maxConcurrent: 10,
      ...c,
    });
    for (let i = 0; i < 3; i += 1) {
      (await limiter.acquire())();
    }

    (await limiter.acquire())();

    expect(c.sleeps).toEqual([1000]);
    expect(c.now()).toBe(1000);
  });

  it('a janela desliza: uma vaga abre quando a mais antiga sai', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      maxConcurrent: 10,
      ...c,
    });
    (await limiter.acquire())(); // t=0
    await c.sleep(600);
    (await limiter.acquire())(); // t=600

    (await limiter.acquire())(); // precisa esperar a de t=0 sair: ate t=1000

    expect(c.now()).toBe(1000);
  });

  it('desiste com rate-limited (e o tempo restante) quando a espera passaria do limite', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      maxConcurrent: 10,
      maxWaitMs: 5_000,
      ...c,
    });
    (await limiter.acquire())();

    const erro = await falha(limiter.acquire());

    expect(erro.kind).toBe('rate-limited');
    expect(erro.detail.retryAfterSeconds).toBe(60);
    expect(c.sleeps).toEqual([]);
  });

  it('o limite padrao e conservador: 50 por minuto (a API permite 60)', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({ maxConcurrent: 100, maxWaitMs: 1, ...c });

    for (let i = 0; i < 50; i += 1) {
      (await limiter.acquire())();
    }

    expect((await falha(limiter.acquire())).kind).toBe('rate-limited');
  });
});

describe('PlantaeRateLimiter: pausa (blockFor)', () => {
  it('nada sai durante a pausa', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({ maxWaitMs: 10_000, ...c });
    limiter.blockFor(3000);

    (await limiter.acquire())();

    expect(c.now()).toBe(3000);
  });

  it('pausa maior que a espera maxima: falha de imediato, informando quanto falta', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({ maxWaitMs: 10_000, ...c });
    limiter.blockFor(3_091_000);

    const erro = await falha(limiter.acquire());

    expect(erro.kind).toBe('rate-limited');
    expect(erro.detail.retryAfterSeconds).toBe(3091);
    expect(c.sleeps).toEqual([]);
  });

  it('uma pausa nunca encurta outra que ja existe', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({ maxWaitMs: 100_000, ...c });
    limiter.blockFor(5000);
    limiter.blockFor(1000);

    (await limiter.acquire())();

    expect(c.now()).toBe(5000);
  });

  it('pausa negativa nao faz nada', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter(c);
    limiter.blockFor(-500);

    (await limiter.acquire())();

    expect(c.sleeps).toEqual([]);
  });
});

describe('PlantaeRateLimiter: concorrencia', () => {
  it('a segunda espera a primeira liberar', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({ maxConcurrent: 1, ...c });
    const release = await limiter.acquire();
    let segunda = false;

    const pending = limiter.acquire().then((r) => {
      segunda = true;
      return r;
    });
    await Promise.resolve();
    expect(segunda).toBe(false);

    release();
    (await pending)();

    expect(segunda).toBe(true);
  });

  it('liberar duas vezes nao abre vaga extra', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({ maxConcurrent: 1, maxWaitMs: 100, ...c });
    const release = await limiter.acquire();
    release();
    release();
    const a = await limiter.acquire();

    // Se a dupla liberacao tivesse aberto 2 vagas, esta passaria.
    expect((await falha(limiter.acquire())).kind).toBe('rate-limited');
    a();
  });

  it('com todas as vagas presas, desiste em vez de esperar para sempre', async () => {
    const c = clock();
    const limiter = new PlantaeRateLimiter({ maxConcurrent: 1, maxWaitMs: 1000, ...c });
    await limiter.acquire();

    expect((await falha(limiter.acquire())).kind).toBe('rate-limited');
  });
});
