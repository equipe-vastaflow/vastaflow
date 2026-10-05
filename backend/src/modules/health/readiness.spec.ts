import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import { DatabaseReadinessIndicator, READINESS_TIMEOUT_MS } from './database-readiness.indicator';
import type { HealthIndicator } from './health.types';
import { ReadinessService } from './readiness.service';

/** Segredos plausiveis de aparecer num erro de driver, usados como armadilha. */
const SEGREDOS = [
  'senha-super-secreta',
  'mysql://vastaflow:senha-super-secreta@db.interno:3306/vastaflow',
  'db.interno',
];

function indicadorCom(query: () => Promise<unknown>): DatabaseReadinessIndicator {
  return new DatabaseReadinessIndicator({ query } as unknown as DataSource);
}

function servicoCom(indicators: HealthIndicator[]): ReadinessService {
  const config = { get: (): string => 'vasta-flow' } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
  return new ReadinessService(config, indicators);
}

describe('DatabaseReadinessIndicator', () => {
  it('banco respondendo: status ok', async () => {
    const indicador = indicadorCom(() => Promise.resolve([{ '1': 1 }]));

    await expect(indicador.check()).resolves.toEqual({
      status: 'ok',
      detail: 'conexao respondendo',
    });
  });

  it('usa SELECT 1: nao depende de tabela nem de migration aplicada', async () => {
    const executadas: unknown[] = [];
    const indicador = new DatabaseReadinessIndicator({
      query: (sql: unknown): Promise<unknown> => {
        executadas.push(sql);
        return Promise.resolve([]);
      },
    } as unknown as DataSource);

    await indicador.check();

    expect(executadas).toEqual(['SELECT 1']);
  });

  it('banco indisponivel: status down', async () => {
    const indicador = indicadorCom(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(indicador.check()).resolves.toEqual({
      status: 'down',
      detail: 'banco indisponivel',
    });
  });

  it('o detalhe NAO repassa a mensagem do erro do driver', async () => {
    // Erros de driver costumam trazer host, usuario e, em alguns casos, a
    // string de conexao inteira. Nada disso pode sair na resposta HTTP.
    for (const segredo of SEGREDOS) {
      const indicador = indicadorCom(() => Promise.reject(new Error(`falhou: ${segredo}`)));

      const resultado = await indicador.check();

      expect(JSON.stringify(resultado)).not.toContain(segredo);
    }
  });

  it('nao vaza stack trace', async () => {
    const indicador = indicadorCom(() => Promise.reject(new Error('qualquer')));

    const resultado = await indicador.check();

    expect(JSON.stringify(resultado)).not.toMatch(/at |\.ts:|\.js:/);
  });

  it('banco pendurado: estoura o prazo e responde down, sem esperar para sempre', async () => {
    jest.useFakeTimers();
    try {
      const indicador = indicadorCom(() => new Promise(() => undefined));
      const pendente = indicador.check();

      await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS + 1);

      await expect(pendente).resolves.toMatchObject({ status: 'down' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('o prazo e curto: readiness decide roteamento de trafego', () => {
    expect(READINESS_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('o nome do componente e estavel', () => {
    expect(indicadorCom(() => Promise.resolve([])).name).toBe('database');
  });
});

describe('ReadinessService', () => {
  const ok: HealthIndicator = {
    name: 'database',
    check: () => Promise.resolve({ status: 'ok' as const, detail: 'conexao respondendo' }),
  };
  const down: HealthIndicator = {
    name: 'database',
    check: () => Promise.resolve({ status: 'down' as const, detail: 'banco indisponivel' }),
  };

  it('tudo ok: status ok e unavailable false', async () => {
    const resultado = await servicoCom([ok]).check();

    expect(resultado.unavailable).toBe(false);
    expect(resultado.body).toEqual({
      status: 'ok',
      service: 'vasta-flow',
      checks: { database: { status: 'ok', detail: 'conexao respondendo' } },
    });
  });

  it('componente down: unavailable true, para o controller responder 503', async () => {
    const resultado = await servicoCom([down]).check();

    expect(resultado.unavailable).toBe(true);
    expect(resultado.body.status).toBe('down');
  });

  it('indicador que LANCA e reportado como down, sem derrubar a resposta', async () => {
    const explode: HealthIndicator = {
      name: 'database',
      check: () => Promise.reject(new Error('inesperado')),
    };

    const resultado = await servicoCom([explode]).check();

    expect(resultado.unavailable).toBe(true);
    expect(resultado.body.checks?.database).toEqual({
      status: 'down',
      detail: 'verificacao falhou',
    });
  });

  it('degraded nao torna a aplicacao indisponivel', async () => {
    const degradado: HealthIndicator = {
      name: 'database',
      check: () => Promise.resolve({ status: 'degraded' as const }),
    };

    const resultado = await servicoCom([degradado]).check();

    expect(resultado.body.status).toBe('degraded');
    expect(resultado.unavailable).toBe(false);
  });

  it('o pior estado entre os componentes vence', async () => {
    const outro: HealthIndicator = {
      name: 'outro',
      check: () => Promise.resolve({ status: 'ok' as const }),
    };

    const resultado = await servicoCom([outro, down]).check();

    expect(resultado.body.status).toBe('down');
  });

  it('a resposta nao expoe host, usuario nem senha', async () => {
    const resultado = await servicoCom([down]).check();

    expect(JSON.stringify(resultado.body)).not.toMatch(/localhost|127\.0\.0\.1|senha|password/i);
  });
});
