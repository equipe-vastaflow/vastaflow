import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource, type Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import { RETENTION_INITIAL_DELAY_MS, RETENTION_INTERVAL_MS } from './telegram-events.policy';
import { TelegramEventsRetentionService } from './telegram-events-retention.service';
import { InboundEventStatus, TelegramInboundEvent } from './telegram-inbound-event.entity';
import { TelegramInboundEventsRepository } from './telegram-inbound-events.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-10T12:00:00Z');

function config(over: Record<string, unknown> = {}): ConfigService<EnvironmentVariables, true> {
  const values: Record<string, unknown> = {
    TELEGRAM_EVENTS_PURGE_ENABLED: true,
    TELEGRAM_EVENTS_RETENTION_DAYS: 30,
    ...over,
  };
  return { get: (key: string): unknown => values[key] } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
}

describe('TelegramEventsRetentionService', () => {
  let dataSource: DataSource;
  let orm: Repository<TelegramInboundEvent>;
  let events: TelegramInboundEventsRepository;
  let record: jest.Mock;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'sqljs',
      entities: [TelegramInboundEvent],
      synchronize: true,
    });
    await dataSource.initialize();
    orm = dataSource.getRepository(TelegramInboundEvent);
    events = new TelegramInboundEventsRepository(orm);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await orm.clear();
    record = jest.fn().mockResolvedValue(undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function service(over: Record<string, unknown> = {}): TelegramEventsRetentionService {
    return new TelegramEventsRetentionService(config(over), events, { record }, () => NOW);
  }

  async function seed(
    updateId: number,
    status: InboundEventStatus,
    idadeDias: number,
  ): Promise<void> {
    await orm.insert({
      canal: 'telegram',
      botId: '111',
      updateId,
      status,
      resultado: null,
      usuarioId: null,
      createdAt: new Date(NOW.getTime() - idadeDias * DAY_MS),
    });
  }

  async function restantes(): Promise<number[]> {
    return (await orm.find({ order: { updateId: 'ASC' } })).map((e) => e.updateId);
  }

  it('apaga so terminais antigos; preserva recentes e PROCESSANDO (mesmo antigo)', async () => {
    await seed(1, InboundEventStatus.Concluido, 40);
    await seed(2, InboundEventStatus.Falhou, 31);
    await seed(3, InboundEventStatus.Abandonado, 45);
    await seed(4, InboundEventStatus.Processando, 90);
    await seed(5, InboundEventStatus.Concluido, 29);
    await seed(6, InboundEventStatus.Concluido, 1);

    expect(await service().runOnce()).toBe(3);
    expect(await restantes()).toEqual([4, 5, 6]);
  });

  it('respeita o prazo configurado', async () => {
    await seed(1, InboundEventStatus.Concluido, 10);
    await seed(2, InboundEventStatus.Concluido, 6);

    expect(await service({ TELEGRAM_EVENTS_RETENTION_DAYS: 7 }).runOnce()).toBe(1);
    expect(await restantes()).toEqual([2]);
  });

  it.each([
    ['abaixo do piso de 7 dias', 6],
    ['zero', 0],
    ['negativo', -1],
    ['fracionado', 7.5],
    ['nao numerico', 'abc'],
    ['ausente', undefined],
  ])('prazo invalido (%s): nao apaga nada', async (_nome, dias) => {
    await seed(1, InboundEventStatus.Concluido, 400);

    expect(await service({ TELEGRAM_EVENTS_RETENTION_DAYS: dias }).runOnce()).toBeNull();
    expect(await restantes()).toEqual([1]);
    expect(record).not.toHaveBeenCalled();
  });

  it('audita so com numeros quando apagou algo, e nao audita dia vazio', async () => {
    await seed(1, InboundEventStatus.Concluido, 40);
    const s = service();

    await s.runOnce();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      acao: AuditAction.TelegramEventAdmin,
      modulo: AuditModuleName.Channels,
      descricao: 'Limpeza automatica de eventos do Telegram',
      metadados: { operacao: 'limpar', origem: 'agendada', quantidade: 1, dias: 30 },
    });

    expect(await s.runOnce()).toBe(0);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('o log traz so contagem e prazo (sem ids, canal nem conteudo)', async () => {
    await seed(987654, InboundEventStatus.Concluido, 40);

    await service().runOnce();

    const linhas = log.mock.calls.map(([t]) => String(t));
    expect(linhas).toEqual(['Telegram: 1 evento(s) antigo(s) removido(s) (retencao de 30 dias)']);
    expect(linhas.join(' ')).not.toMatch(/987654|111|telegram_inbound/);
  });

  it('falha do banco: nao lanca, loga so o nome do erro e segue funcionando', async () => {
    const quebrado = new TelegramEventsRetentionService(
      config(),
      {
        purgeTerminalBefore: jest
          .fn()
          .mockRejectedValue(new Error('SEGREDO connect mysql://u:p@h')),
      } as unknown as TelegramInboundEventsRepository,
      { record },
      () => NOW,
    );

    await expect(quebrado.runOnce()).resolves.toBeNull();
    expect(warn.mock.calls.map(([t]) => String(t))).toEqual([
      'Telegram: limpeza de eventos falhou (Error)',
    ]);
    expect(record).not.toHaveBeenCalled();
  });

  it('falha ao auditar nao propaga', async () => {
    await seed(1, InboundEventStatus.Concluido, 40);
    record.mockRejectedValue(new Error('auditoria fora'));

    await expect(service().runOnce()).resolves.toBeNull();
    expect(await restantes()).toEqual([]);
  });

  it('nao roda duas passadas ao mesmo tempo', async () => {
    let liberar: (n: number) => void = () => undefined;
    const purge = jest.fn().mockReturnValue(
      new Promise<number>((resolve) => {
        liberar = resolve;
      }),
    );
    const s = new TelegramEventsRetentionService(
      config(),
      { purgeTerminalBefore: purge } as unknown as TelegramInboundEventsRepository,
      { record },
      () => NOW,
    );

    const primeira = s.runOnce();
    expect(await s.runOnce()).toBeNull();
    liberar(0);
    expect(await primeira).toBe(0);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('nunca toca o ingest: um update recente continua DUPLICATE depois da limpeza', async () => {
    await seed(1, InboundEventStatus.Concluido, 40);
    const recente = await events.claim('telegram', '111', 2);
    expect(recente).not.toBeNull();

    await service().runOnce();

    expect(await events.claim('telegram', '111', 2)).toBeNull();
    expect(await events.claim('telegram', '111', 3)).not.toBeNull();
  });

  describe('agendamento', () => {
    it('desligada: nao agenda nada', () => {
      jest.useFakeTimers();
      const s = service({ TELEGRAM_EVENTS_PURGE_ENABLED: false });

      s.onApplicationBootstrap();

      expect(jest.getTimerCount()).toBe(0);
    });

    it('prazo invalido: nao agenda e avisa sem dados', () => {
      jest.useFakeTimers();
      const s = service({ TELEGRAM_EVENTS_RETENTION_DAYS: 3 });

      s.onApplicationBootstrap();

      expect(jest.getTimerCount()).toBe(0);
      expect(warn.mock.calls.map(([t]) => String(t))).toEqual([
        'Telegram: retencao de eventos nao iniciada (prazo invalido)',
      ]);
    });

    it('ligada: espera o atraso inicial, roda e reagenda a cada 24 h; shutdown limpa o timer', async () => {
      jest.useFakeTimers();
      const purge = jest.fn().mockResolvedValue(0);
      const s = new TelegramEventsRetentionService(
        config(),
        { purgeTerminalBefore: purge } as unknown as TelegramInboundEventsRepository,
        { record },
        () => NOW,
      );

      s.onApplicationBootstrap();
      expect(purge).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(RETENTION_INITIAL_DELAY_MS);
      expect(purge).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
      expect(purge).toHaveBeenCalledTimes(2);

      await s.onApplicationShutdown();
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 2);
      expect(purge).toHaveBeenCalledTimes(2);
    });

    it('uma falha na passada nao interrompe as proximas', async () => {
      jest.useFakeTimers();
      const purge = jest.fn().mockRejectedValueOnce(new Error('banco fora')).mockResolvedValue(0);
      const s = new TelegramEventsRetentionService(
        config(),
        { purgeTerminalBefore: purge } as unknown as TelegramInboundEventsRepository,
        { record },
        () => NOW,
      );

      s.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(RETENTION_INITIAL_DELAY_MS);
      await jest.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);

      expect(purge).toHaveBeenCalledTimes(2);
      await s.onApplicationShutdown();
    });
  });
});
