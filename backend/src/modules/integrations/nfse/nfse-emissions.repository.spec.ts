import { DataSource } from 'typeorm';
import { NfseEmission, NfseEmissionStatus } from './nfse-emission.entity';
import { NfseEmissionsRepository, type NewEmission } from './nfse-emissions.repository';

const NOW = new Date('2026-10-15T15:00:00Z');
const LATER = new Date('2026-10-15T15:10:00Z');
const MIDDLE = new Date('2026-10-15T15:05:00Z');

function pending(over: Partial<NewEmission> = {}): NewEmission {
  return {
    usuarioId: 'user-1',
    canal: 'telegram',
    ambiente: 2,
    serie: '00001',
    dados: {} as NewEmission['dados'],
    confirmHash: 'a'.repeat(64),
    confirmExpiresAt: LATER,
    identify: (numero) => ({
      dpsId: `DPS${String(numero).padStart(42, '0')}`,
      resumoHash: 'b'.repeat(64),
    }),
    ...over,
  };
}

describe('NFS-e - repositorio (transicoes condicionais e indices unicos)', () => {
  let dataSource: DataSource;
  let repository: NfseEmissionsRepository;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'sqljs', entities: [NfseEmission], synchronize: true });
    await dataSource.initialize();
    repository = new NfseEmissionsRepository(dataSource.getRepository(NfseEmission));
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('numera as DPS em sequencia por ambiente e serie, inclusive sob concorrencia', async () => {
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        repository.createPending(pending({ confirmHash: String(index).repeat(64).slice(0, 64) })),
      ),
    );
    expect(created.map((row) => row.numeroDps).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    // Outro ambiente tem a propria sequencia, mesmo que o Id da DPS (que nao traz o ambiente) se repita.
    const other = await repository.createPending(
      pending({ ambiente: 1, confirmHash: 'c'.repeat(64) }),
    );
    expect(other.numeroDps).toBe(1);
  });

  it('o indice unico impede dois pedidos com o mesmo codigo de confirmacao', async () => {
    await repository.createPending(pending());
    await expect(repository.createPending(pending())).rejects.toThrow();
  });

  it('consumir a confirmacao funciona UMA vez e so com hash, dono, canal e prazo corretos', async () => {
    const row = await repository.createPending(pending());
    const hash = 'a'.repeat(64);
    expect(await repository.consumeConfirmation(row.id, 'user-2', 'telegram', hash, NOW)).toBe(
      false,
    );
    expect(await repository.consumeConfirmation(row.id, 'user-1', 'whatsapp', hash, NOW)).toBe(
      false,
    );
    expect(
      await repository.consumeConfirmation(row.id, 'user-1', 'telegram', 'f'.repeat(64), NOW),
    ).toBe(false);
    expect(await repository.consumeConfirmation(row.id, 'user-1', 'telegram', hash, LATER)).toBe(
      false,
    );
    expect((await repository.findById(row.id))?.status).toBe(
      NfseEmissionStatus.AguardandoConfirmacao,
    );

    expect(await repository.consumeConfirmation(row.id, 'user-1', 'telegram', hash, NOW)).toBe(
      true,
    );
    expect(await repository.consumeConfirmation(row.id, 'user-1', 'telegram', hash, NOW)).toBe(
      false,
    );
    const consumed = await repository.findById(row.id);
    expect(consumed).toMatchObject({
      status: NfseEmissionStatus.Enviando,
      confirmHash: null,
      tentativas: 1,
    });
  });

  it('consumos simultaneos: exatamente um ganha', async () => {
    const row = await repository.createPending(pending());
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.consumeConfirmation(row.id, 'user-1', 'telegram', 'a'.repeat(64), NOW),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('a transicao so acontece a partir do estado de origem esperado (nunca sobrescreve outro estado)', async () => {
    const row = await repository.createPending(pending());
    // AGUARDANDO nao vira AUTORIZADA diretamente: a origem esperada e ENVIANDO.
    expect(
      await repository.transition(row.id, NfseEmissionStatus.Enviando, {
        status: NfseEmissionStatus.Autorizada,
        chaveAcesso: '1'.repeat(50),
      }),
    ).toBe(false);
    expect(await repository.findById(row.id)).toMatchObject({
      status: NfseEmissionStatus.AguardandoConfirmacao,
      chaveAcesso: null,
    });

    await repository.consumeConfirmation(row.id, 'user-1', 'telegram', 'a'.repeat(64), NOW);
    expect(
      await repository.transition(row.id, NfseEmissionStatus.Enviando, {
        status: NfseEmissionStatus.Rejeitada,
        erroCodigo: 'E0310',
      }),
    ).toBe(true);
    // Estado final nao muda de novo, nem por quem achava que ainda estava ENVIANDO.
    expect(
      await repository.transition(row.id, NfseEmissionStatus.Enviando, {
        status: NfseEmissionStatus.Autorizada,
        chaveAcesso: '2'.repeat(50),
      }),
    ).toBe(false);
    expect(await repository.findById(row.id)).toMatchObject({
      status: NfseEmissionStatus.Rejeitada,
      chaveAcesso: null,
      erroCodigo: 'E0310',
    });
  });

  it('a mesma chave de acesso nao pode pertencer a dois pedidos', async () => {
    const a = await repository.createPending(pending({ confirmHash: '1'.repeat(64) }));
    const b = await repository.createPending(pending({ confirmHash: '2'.repeat(64) }));
    for (const row of [a, b]) {
      await repository.consumeConfirmation(
        row.id,
        'user-1',
        'telegram',
        row.confirmHash ?? '',
        NOW,
      );
    }
    expect(
      await repository.transition(a.id, NfseEmissionStatus.Enviando, {
        status: NfseEmissionStatus.Autorizada,
        chaveAcesso: '9'.repeat(50),
      }),
    ).toBe(true);
    await expect(
      repository.transition(b.id, NfseEmissionStatus.Enviando, {
        status: NfseEmissionStatus.Autorizada,
        chaveAcesso: '9'.repeat(50),
      }),
    ).rejects.toThrow();
  });

  it('um pedido novo expira so os pendentes DA MESMA pessoa', async () => {
    const mine = await repository.createPending(pending({ confirmHash: '1'.repeat(64) }));
    const theirs = await repository.createPending(
      pending({ usuarioId: 'user-2', confirmHash: '2'.repeat(64) }),
    );
    await repository.expirePendingOf('user-1');
    expect((await repository.findById(mine.id))?.status).toBe(NfseEmissionStatus.Expirada);
    expect((await repository.findById(mine.id))?.confirmHash).toBeNull();
    expect((await repository.findById(theirs.id))?.status).toBe(
      NfseEmissionStatus.AguardandoConfirmacao,
    );
  });

  it('ENVIANDO parado vira INCERTA, mas so o da pessoa e so o antigo', async () => {
    const old = await repository.createPending(pending({ confirmHash: '1'.repeat(64) }));
    const fresh = await repository.createPending(pending({ confirmHash: '2'.repeat(64) }));
    await repository.consumeConfirmation(old.id, 'user-1', 'telegram', '1'.repeat(64), NOW);
    await repository.consumeConfirmation(fresh.id, 'user-1', 'telegram', '2'.repeat(64), MIDDLE);
    await repository.markStaleAsUncertain('user-1', new Date(NOW.getTime() + 60_000));
    expect((await repository.findById(old.id))?.status).toBe(NfseEmissionStatus.Incerta);
    expect((await repository.findById(fresh.id))?.status).toBe(NfseEmissionStatus.Enviando);
  });
});
