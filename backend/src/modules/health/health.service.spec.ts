import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { HEALTH_INDICATORS, type HealthIndicator } from './health.types';

function buildModule(indicators: HealthIndicator[]): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      HealthService,
      { provide: HEALTH_INDICATORS, useValue: indicators },
      {
        provide: ConfigService,
        useValue: { get: (): string => 'vasta-flow' },
      },
    ],
  }).compile();
}

describe('HealthService', () => {
  it('responde no formato exigido quando nao ha indicadores registrados', async () => {
    const module = await buildModule([]);
    const service = module.get(HealthService);

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      service: 'vasta-flow',
    });
  });

  it('inclui o detalhamento por componente quando ha indicadores', async () => {
    const module = await buildModule([
      {
        name: 'database',
        check: () => Promise.resolve({ status: 'ok' as const, detail: 'conectado' }),
      },
    ]);

    await expect(module.get(HealthService).check()).resolves.toEqual({
      status: 'ok',
      service: 'vasta-flow',
      checks: { database: { status: 'ok', detail: 'conectado' } },
    });
  });

  it('assume o pior estado entre os componentes', async () => {
    const module = await buildModule([
      { name: 'a', check: () => Promise.resolve({ status: 'ok' as const }) },
      { name: 'b', check: () => Promise.resolve({ status: 'degraded' as const }) },
      { name: 'c', check: () => Promise.resolve({ status: 'down' as const }) },
    ]);

    const result = await module.get(HealthService).check();

    expect(result.status).toBe('down');
  });

  it('isola a falha de um indicador sem derrubar o endpoint', async () => {
    const module = await buildModule([
      {
        name: 'quebrado',
        check: () => Promise.reject(new Error('timeout na conexao')),
      },
      { name: 'saudavel', check: () => Promise.resolve({ status: 'ok' as const }) },
    ]);

    const result = await module.get(HealthService).check();

    expect(result.status).toBe('down');
    expect(result.checks?.quebrado).toEqual({ status: 'down', detail: 'verificacao falhou' });
    expect(result.checks?.saudavel).toEqual({ status: 'ok', detail: undefined });
  });

  it('nao vaza a mensagem de erro original do indicador na resposta', async () => {
    const module = await buildModule([
      {
        name: 'banco',
        check: () => Promise.reject(new Error('Access denied for user root@10.0.0.5')),
      },
    ]);

    const result = await module.get(HealthService).check();

    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });
});
