import { DataSource, QueryFailedError, type Repository } from 'typeorm';
import { InboundEventStatus, TelegramInboundEvent } from './telegram-inbound-event.entity';
import { TelegramInboundEventsRepository } from './telegram-inbound-events.repository';

/**
 * Banco SQLite em memoria com o schema gerado da PROPRIA entity: o indice unico
 * testado aqui e o declarado na entity (o mesmo que as migrations criam).
 */
describe('TelegramInboundEventsRepository', () => {
  let dataSource: DataSource;
  let orm: Repository<TelegramInboundEvent>;
  let repo: TelegramInboundEventsRepository;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'sqljs',
      entities: [TelegramInboundEvent],
      synchronize: true,
    });
    await dataSource.initialize();
    orm = dataSource.getRepository(TelegramInboundEvent);
    repo = new TelegramInboundEventsRepository(orm);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await orm.clear();
  });

  it('reserva um update novo como PROCESSANDO, sem resultado nem usuario', async () => {
    const evento = await repo.claim('telegram', '111', 1);

    expect(evento).toMatchObject({
      canal: 'telegram',
      botId: '111',
      updateId: 1,
      status: InboundEventStatus.Processando,
      resultado: null,
      usuarioId: null,
    });
    expect(evento?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('o MESMO (canal, bot, update) nao reserva duas vezes: a segunda devolve null', async () => {
    expect(await repo.claim('telegram', '111', 7)).not.toBeNull();
    expect(await repo.claim('telegram', '111', 7)).toBeNull();
    expect(await orm.count()).toBe(1);
  });

  it('o indice UNICO e do banco (nao depende da logica do repositorio)', async () => {
    const base = {
      canal: 'telegram',
      botId: '111',
      updateId: 9,
      status: InboundEventStatus.Processando,
    };
    await orm.save(orm.create(base));

    await expect(orm.save(orm.create(base))).rejects.toBeInstanceOf(QueryFailedError);
  });

  it.each([
    ['outro update', 'telegram', '111', 2],
    ['outro bot', 'telegram', '222', 1],
    ['outro canal', 'whatsapp', '111', 1],
  ])('%s e outro evento', async (_nome, canal, bot, update) => {
    await repo.claim('telegram', '111', 1);

    expect(await repo.claim(canal, bot, update)).not.toBeNull();
  });

  it('corrida: de N reservas simultaneas, exatamente uma passa', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => repo.claim('telegram', '111', 55)),
    );

    expect(resultados.filter((r) => r !== null)).toHaveLength(1);
    expect(await orm.count()).toBe(1);
  });

  it('update_id grande (muito acima de 32 bits) e preservado como numero', async () => {
    const grande = 2_147_483_649_000;
    await repo.claim('telegram', '111', grande);

    const lido = await repo.findByUpdate('telegram', '111', grande);

    expect(lido?.updateId).toBe(grande);
    expect(typeof lido?.updateId).toBe('number');
  });

  it('finish grava status, resultado e usuario', async () => {
    const evento = await repo.claim('telegram', '111', 3);

    await repo.finish(evento?.id ?? '', InboundEventStatus.Concluido, 'EXECUTED', 'user-1');

    expect(await repo.findByUpdate('telegram', '111', 3)).toMatchObject({
      status: InboundEventStatus.Concluido,
      resultado: 'EXECUTED',
      usuarioId: 'user-1',
    });
  });

  it('findByUpdate de update inexistente: null', async () => {
    expect(await repo.findByUpdate('telegram', '111', 404)).toBeNull();
  });

  it('erro que NAO e de unicidade nao e engolido', async () => {
    const quebrado = new TelegramInboundEventsRepository({
      create: () => ({}),
      save: () => Promise.reject(new Error('banco fora')),
    } as unknown as Repository<TelegramInboundEvent>);

    await expect(quebrado.claim('telegram', '111', 1)).rejects.toThrow('banco fora');
  });

  it('a tabela nao tem coluna para texto, resposta ou nome', () => {
    const colunas = dataSource
      .getMetadata(TelegramInboundEvent)
      .columns.map((c) => c.databaseName)
      .sort();

    expect(colunas).toEqual(
      [
        'bot_id',
        'canal',
        'created_at',
        'id',
        'resultado',
        'status',
        'update_id',
        'updated_at',
        'usuario_id',
      ].sort(),
    );
  });
  describe('eventos presos e retencao (Fase 5.1)', () => {
    const minutosAtras = (min: number): Date => new Date(Date.now() - min * 60_000);

    async function inserir(
      updateId: number,
      status: InboundEventStatus,
      criadoHa: Date,
    ): Promise<TelegramInboundEvent> {
      const evento = await orm.save(
        orm.create({ canal: 'telegram', botId: '111', updateId, status }),
      );
      // `created_at` e gerado pelo banco: recua a data para simular o passado.
      await orm.query('UPDATE telegram_inbound_events SET created_at = ? WHERE id = ?', [
        criadoHa.toISOString().replace('T', ' ').replace('Z', ''),
        evento.id,
      ]);
      return evento;
    }

    it('countByStatus conta por status', async () => {
      await inserir(1, InboundEventStatus.Concluido, minutosAtras(1));
      await inserir(2, InboundEventStatus.Concluido, minutosAtras(1));
      await inserir(3, InboundEventStatus.Processando, minutosAtras(1));

      expect(await repo.countByStatus()).toEqual({ CONCLUIDO: 2, PROCESSANDO: 1 });
    });

    it('findStuck devolve so PROCESSANDO antigo, do mais velho ao mais novo', async () => {
      await inserir(1, InboundEventStatus.Processando, minutosAtras(60));
      await inserir(2, InboundEventStatus.Processando, minutosAtras(30));
      await inserir(3, InboundEventStatus.Processando, minutosAtras(1)); // recente: nao esta preso
      await inserir(4, InboundEventStatus.Concluido, minutosAtras(90)); // terminal: nunca "preso"

      const presos = await repo.findStuck(minutosAtras(15));

      expect(presos.map((e) => e.updateId)).toEqual([1, 2]);
    });

    it('abandon encerra o evento preso e MANTEM a reserva (o update nao volta a executar)', async () => {
      const preso = await inserir(7, InboundEventStatus.Processando, minutosAtras(60));

      expect(await repo.abandon(preso.id, minutosAtras(15))).toBe(true);

      const lido = await repo.findByUpdate('telegram', '111', 7);
      expect(lido).toMatchObject({ status: InboundEventStatus.Abandonado, resultado: 'ABANDONED' });
      // A reserva continua valendo: a mesma entrega ainda e duplicada.
      expect(await repo.claim('telegram', '111', 7)).toBeNull();
    });

    it.each([
      ['evento recente', InboundEventStatus.Processando, 1],
      ['evento ja concluido', InboundEventStatus.Concluido, 60],
      ['evento que falhou', InboundEventStatus.Falhou, 60],
    ])('abandon recusa %s', async (_nome, status, idade) => {
      const e = await inserir(8, status, minutosAtras(idade));

      expect(await repo.abandon(e.id, minutosAtras(15))).toBe(false);
      expect((await repo.findByUpdate('telegram', '111', 8))?.status).toBe(status);
    });

    it('abandon de id inexistente: false', async () => {
      expect(await repo.abandon('00000000-0000-4000-8000-000000000000', new Date())).toBe(false);
    });

    it('purge apaga SO terminais antigos; nunca PROCESSANDO nem recentes', async () => {
      const dias = (n: number): Date => minutosAtras(n * 24 * 60);
      await inserir(1, InboundEventStatus.Concluido, dias(40));
      await inserir(2, InboundEventStatus.Falhou, dias(40));
      await inserir(3, InboundEventStatus.Abandonado, dias(40));
      await inserir(4, InboundEventStatus.Processando, dias(40)); // preso: exige decisao humana
      await inserir(5, InboundEventStatus.Concluido, dias(2)); // recente

      expect(await repo.countTerminalBefore(dias(30))).toBe(3);
      expect(await repo.purgeTerminalBefore(dias(30))).toBe(3);

      const restantes = (await orm.find({ order: { updateId: 'ASC' } })).map((e) => e.updateId);
      expect(restantes).toEqual([4, 5]);
    });

    it('depois do purge o update antigo seria tratado como novo - por isso o piso de retencao existe', async () => {
      const dias = (n: number): Date => minutosAtras(n * 24 * 60);
      await inserir(9, InboundEventStatus.Concluido, dias(40));
      await repo.purgeTerminalBefore(dias(30));

      expect(await repo.claim('telegram', '111', 9)).not.toBeNull();
    });
  });
});
