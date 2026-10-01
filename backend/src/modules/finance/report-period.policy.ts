/** Periodo maximo de um relatorio, em dias. Um ano. */
export const MAX_REPORT_PERIOD_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Sucesso nao devolve nada; falha traz a mensagem do 400. */
export type PeriodCheck = { ok: true } | { ok: false; erro: string };

/**
 * Regras do periodo de um relatorio.
 *
 * Aqui ficam as regras que dependem das DUAS datas e por isso nao cabem num
 * decorator de propriedade:
 *
 * - cada data tem de existir no calendario;
 * - `ate` nao pode ser anterior a `de`;
 * - o periodo nao pode passar de um ano.
 *
 * O limite existe por desempenho: e ele que impede um relatorio de varrer a
 * tabela inteira. 366 dias (e nao 365) para que "01/01 a 31/12" de um ano
 * bissexto caiba.
 *
 * A validacao de calendario e redundante com o DTO - `@IsISO8601({strict:true})`
 * ja recusa 2026-02-30 - e isso e proposital: esta funcao e a autoridade sobre o
 * periodo e nao pode depender de quem a chama ter passado por um DTO.
 *
 * Funcao pura, sem excecao de framework - quem chama decide o que fazer com a
 * recusa. Mesma abordagem de `entry-status.policy.ts` e `setting-value.ts`.
 */
export function checkReportPeriod(de: string, ate: string): PeriodCheck {
  const inicio = parseDay(de);
  const fim = parseDay(ate);

  if (inicio === null || fim === null) {
    return { ok: false, erro: 'de e ate devem ser datas validas no formato YYYY-MM-DD' };
  }
  if (fim < inicio) {
    return { ok: false, erro: 'ate nao pode ser anterior a de' };
  }

  // Inclusivo nas duas pontas: de 01/01 a 01/01 e um dia.
  const dias = (fim - inicio) / MS_PER_DAY + 1;
  if (dias > MAX_REPORT_PERIOD_DAYS) {
    return {
      ok: false,
      erro: `o periodo do relatorio nao pode passar de ${MAX_REPORT_PERIOD_DAYS} dias`,
    };
  }

  return { ok: true };
}

/**
 * Converte `YYYY-MM-DD` em instante UTC, ou `null` se o dia nao existir.
 *
 * Em UTC de proposito: as duas pontas sao dias, sem hora, e interpretar em fuso
 * local faria a contagem de dias oscilar conforme a maquina.
 *
 * A comparacao de volta nao e zelo excessivo. `Date.parse` recusa mes fora de
 * faixa (`2026-13-01` da NaN), mas ROLA dia fora do mes em silencio:
 * `2026-02-30` vira 02/03 e `2025-02-29` vira 01/03. Sem conferir, o relatorio
 * sairia de um periodo diferente do pedido, e a data impossivel seguiria para o
 * SQL - onde o MySQL e o Oracle divergem (o Oracle recusa com erro de driver).
 */
function parseDay(valor: string): number | null {
  const ms = Date.parse(`${valor}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10) === valor ? ms : null;
}
