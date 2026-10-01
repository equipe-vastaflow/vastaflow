import { MAX_REPORT_PERIOD_DAYS, checkReportPeriod } from './report-period.policy';

describe('checkReportPeriod', () => {
  describe('periodos aceitos', () => {
    it('aceita um periodo normal', () => {
      expect(checkReportPeriod('2026-01-01', '2026-01-31')).toEqual({ ok: true });
    });

    it('aceita o mesmo dia nas duas pontas', () => {
      // Um unico dia e um periodo valido de um dia, nao de zero.
      expect(checkReportPeriod('2026-03-10', '2026-03-10')).toEqual({ ok: true });
    });

    it('aceita o ano inteiro de um ano bissexto', () => {
      // 2024 tem 366 dias: e o caso que justifica o limite ser 366 e nao 365.
      expect(checkReportPeriod('2024-01-01', '2024-12-31')).toEqual({ ok: true });
    });

    it('aceita o ano inteiro de um ano comum', () => {
      expect(checkReportPeriod('2026-01-01', '2026-12-31')).toEqual({ ok: true });
    });

    it('aceita exatamente o limite de dias', () => {
      // 2026-01-01 + 365 dias = 2026-12-31 e 365 dias; somando um dia chega-se a
      // 366, que ainda cabe.
      expect(checkReportPeriod('2026-01-01', '2027-01-01')).toEqual({ ok: true });
    });
  });

  describe('periodos recusados', () => {
    it('recusa ate anterior a de', () => {
      const resultado = checkReportPeriod('2026-02-01', '2026-01-31');

      expect(resultado.ok).toBe(false);
      expect(resultado).toEqual({ ok: false, erro: 'ate nao pode ser anterior a de' });
    });

    it('recusa um dia alem do limite', () => {
      const resultado = checkReportPeriod('2026-01-01', '2027-01-02');

      expect(resultado.ok).toBe(false);
      expect(resultado).toEqual({
        ok: false,
        erro: `o periodo do relatorio nao pode passar de ${MAX_REPORT_PERIOD_DAYS} dias`,
      });
    });

    it('recusa um periodo de varios anos', () => {
      expect(checkReportPeriod('2020-01-01', '2026-12-31').ok).toBe(false);
    });

    it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29'])(
      'recusa a data inexistente %s',
      (data) => {
        // O DTO valida o FORMATO; uma data que nao existe no calendario so e
        // pega aqui.
        const resultado = checkReportPeriod('2026-01-01', data);

        expect(resultado.ok).toBe(false);
        expect(resultado).toEqual({
          ok: false,
          erro: 'de e ate devem ser datas validas no formato YYYY-MM-DD',
        });
      },
    );

    it('recusa data inexistente tambem no inicio do periodo', () => {
      expect(checkReportPeriod('2026-04-31', '2026-05-10').ok).toBe(false);
    });

    it('recusa texto que nao e data', () => {
      expect(checkReportPeriod('ontem', 'hoje').ok).toBe(false);
    });
  });

  it('o limite declarado cobre um ano bissexto inteiro', () => {
    // Blinda a constante: baixa-la para 365 quebraria "01/01 a 31/12" de 2024.
    expect(MAX_REPORT_PERIOD_DAYS).toBeGreaterThanOrEqual(366);
  });

  it('nao depende do fuso horario da maquina', () => {
    // As datas sao dias, sem hora. Interpretar em fuso local faria o limite
    // oscilar conforme a maquina que roda o teste.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      const adiantado = checkReportPeriod('2026-01-01', '2027-01-01');
      process.env.TZ = 'Pacific/Midway'; // UTC-11
      const atrasado = checkReportPeriod('2026-01-01', '2027-01-01');

      expect(adiantado).toEqual({ ok: true });
      expect(atrasado).toEqual({ ok: true });
    } finally {
      process.env.TZ = original;
    }
  });
});
