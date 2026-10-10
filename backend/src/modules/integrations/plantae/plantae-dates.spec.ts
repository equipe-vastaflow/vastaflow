import { isCalendarDate, parseCalendarDate, validatePeriod } from './plantae-dates';

describe('parseCalendarDate', () => {
  it('aceita um dia real', () => {
    expect(parseCalendarDate('2026-09-30')).toEqual({ year: 2026, month: 9, day: 30 });
  });

  it.each([
    ['dia 30 de fevereiro', '2026-02-30'],
    ['29 de fevereiro em ano comum', '2025-02-29'],
    ['29 de fevereiro em seculo nao bissexto', '1900-02-29'],
    ['mes 13', '2026-13-01'],
    ['mes 0', '2026-00-10'],
    ['dia 0', '2026-05-00'],
    ['31 em mes de 30 dias', '2026-04-31'],
    ['sem zero a esquerda', '2026-9-1'],
    ['com hora', '2026-09-01T00:00:00Z'],
    ['barra', '2026/09/01'],
    ['formato brasileiro', '01/09/2026'],
    ['vazio', ''],
    ['espaco', ' 2026-09-01'],
    ['quebra de linha no fim', '2026-09-01\n'],
  ])('recusa %s', (_nome, texto) => {
    expect(parseCalendarDate(texto)).toBeNull();
  });

  it.each([
    ['29 de fevereiro em ano bissexto', '2024-02-29'],
    ['29 de fevereiro em ano divisivel por 400', '2000-02-29'],
    ['31 de dezembro', '2026-12-31'],
  ])('aceita %s', (_nome, texto) => {
    expect(parseCalendarDate(texto)).not.toBeNull();
  });

  it('nao usa Date.parse: nao "corrige" data impossivel', () => {
    // `new Date('2026-02-30')` e invalida, mas `new Date(2026, 1, 30)` vira 2 de marco.
    expect(isCalendarDate('2026-02-30')).toBe(false);
  });

  it('respeita os limites de ano informados', () => {
    expect(parseCalendarDate('1899-12-31', { minYear: 1900, maxYear: 2100 })).toBeNull();
    expect(parseCalendarDate('2101-01-01', { minYear: 1900, maxYear: 2100 })).toBeNull();
    expect(parseCalendarDate('1900-01-01', { minYear: 1900, maxYear: 2100 })).not.toBeNull();
  });
});

describe('validatePeriod', () => {
  it('aceita um mes inteiro, com os dois extremos incluidos', () => {
    expect(validatePeriod('2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('aceita um unico dia (inicio = fim)', () => {
    expect(validatePeriod('2026-09-01', '2026-09-01')).toEqual([]);
  });

  describe('limite de 366 dias (extremos incluidos)', () => {
    it('366 dias exatos: aceito', () => {
      // 2024-01-01 a 2024-12-31 = 366 dias (ano bissexto).
      expect(validatePeriod('2024-01-01', '2024-12-31')).toEqual([]);
    });

    it('367 dias: recusado', () => {
      expect(validatePeriod('2024-01-01', '2025-01-01')).toEqual([
        'o periodo pode ter no maximo 366 dias',
      ]);
    });

    it('365 dias de ano comum: aceito', () => {
      expect(validatePeriod('2025-01-01', '2025-12-31')).toEqual([]);
    });

    it('um ano comum + 1 dia (366): aceito; +2 (367): recusado', () => {
      expect(validatePeriod('2025-01-01', '2026-01-01')).toEqual([]);
      expect(validatePeriod('2025-01-01', '2026-01-02')).toHaveLength(1);
    });
  });

  it('recusa inicio posterior ao fim', () => {
    expect(validatePeriod('2026-09-30', '2026-09-01')).toEqual([
      'data_inicio nao pode ser posterior a data_fim',
    ]);
  });

  it('aponta QUAL data e invalida', () => {
    expect(validatePeriod('2026-02-30', '2026-03-01')).toEqual([
      'data_inicio deve ser uma data real no formato AAAA-MM-DD',
    ]);
    expect(validatePeriod('2026-03-01', 'ontem')).toEqual([
      'data_fim deve ser uma data real no formato AAAA-MM-DD',
    ]);
  });

  it('recusa anos absurdos para um filtro', () => {
    expect(validatePeriod('1800-01-01', '1800-01-02')).toHaveLength(2);
    expect(validatePeriod('2999-01-01', '2999-01-02')).toHaveLength(2);
  });

  it('nao depende do fuso horario do servidor (a conta e em UTC)', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['America/Sao_Paulo', 'Pacific/Auckland', 'UTC']) {
        process.env.TZ = tz;
        // A virada do horario de verao nao muda o numero de DIAS de calendario.
        expect(validatePeriod('2026-10-01', '2026-11-30')).toEqual([]);
        expect(validatePeriod('2025-01-01', '2026-01-02')).toHaveLength(1);
      }
    } finally {
      if (original === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = original;
      }
    }
  });
});
