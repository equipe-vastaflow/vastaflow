import { SystemSettingType } from './system-setting.enums';

/** Valor de uma configuracao, ja tipado. Nunca `any`, nunca objeto. */
export type SettingValue = string | number | boolean;

/** Tamanho da coluna `valor`; o texto serializado precisa caber nela. */
export const SETTING_VALUE_MAX_LENGTH = 500;

/**
 * Faixa aceita para configuracoes numericas.
 *
 * Configuracao de sistema e limite, contador ou prazo - nao e dinheiro nem
 * medida cientifica. A faixa evita que um numero absurdo (ou um valor que nao
 * sobrevive a ida e volta em ponto flutuante) entre pela API.
 */
export const SETTING_NUMBER_MIN = -1_000_000_000;
export const SETTING_NUMBER_MAX = 1_000_000_000;

/** Sucesso traz o valor ja convertido; falha traz a mensagem para o 400. */
export type ParsedSettingValue = { ok: true; value: SettingValue } | { ok: false; erro: string };

/**
 * Valida o valor recebido do cliente contra o `tipo` declarado da configuracao.
 *
 * NAO ha coercao: `"false"` continua sendo a string `"false"` e e RECUSADO numa
 * configuracao BOOLEAN, em vez de virar `true` por uma conversao ingenua. Como
 * o corpo chega em JSON, o tipo ja vem do proprio payload e pode ser exigido.
 *
 * Funcao pura, sem excecao de framework: quem chama decide o que fazer com a
 * recusa (mesma abordagem de `entry-status.policy.ts` no financeiro).
 */
export function parseSettingValue(tipo: SystemSettingType, raw: unknown): ParsedSettingValue {
  switch (tipo) {
    case SystemSettingType.String:
      return parseString(raw);
    case SystemSettingType.Number:
      return parseNumber(raw);
    case SystemSettingType.Boolean:
      return parseBoolean(raw);
  }
}

function parseString(raw: unknown): ParsedSettingValue {
  if (typeof raw !== 'string') {
    return { ok: false, erro: `valor deve ser um texto (recebido: ${describe(raw)})` };
  }
  const texto = raw.trim();
  if (texto === '') {
    return { ok: false, erro: 'valor nao pode ser vazio' };
  }
  if (texto.length > SETTING_VALUE_MAX_LENGTH) {
    return { ok: false, erro: `valor deve ter no maximo ${SETTING_VALUE_MAX_LENGTH} caracteres` };
  }
  return { ok: true, value: texto };
}

function parseNumber(raw: unknown): ParsedSettingValue {
  if (typeof raw !== 'number') {
    return { ok: false, erro: `valor deve ser um numero (recebido: ${describe(raw)})` };
  }
  // Cobre NaN e Infinity de uma vez.
  if (!Number.isFinite(raw)) {
    return { ok: false, erro: 'valor deve ser um numero finito' };
  }
  if (raw < SETTING_NUMBER_MIN || raw > SETTING_NUMBER_MAX) {
    return {
      ok: false,
      erro: `valor deve estar entre ${SETTING_NUMBER_MIN} e ${SETTING_NUMBER_MAX}`,
    };
  }
  return { ok: true, value: raw };
}

function parseBoolean(raw: unknown): ParsedSettingValue {
  if (typeof raw !== 'boolean') {
    return {
      ok: false,
      erro: `valor deve ser true ou false, sem aspas (recebido: ${describe(raw)})`,
    };
  }
  return { ok: true, value: raw };
}

/** Texto gravado na coluna `valor`. */
export function serializeSettingValue(value: SettingValue): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * Le a coluna `valor` de volta para o tipo declarado.
 *
 * Toda escrita passa por `parseSettingValue`, entao um texto que nao volta ao
 * tipo so aparece se a linha for alterada por fora (SQL manual). Nesse caso a
 * falha e ruidosa de proposito: devolver um valor adivinhado seria pior do que
 * parar - quem consome `getNumber` espera um numero de verdade.
 */
export function readSettingValue(tipo: SystemSettingType, stored: string): SettingValue {
  switch (tipo) {
    case SystemSettingType.String:
      return stored;
    case SystemSettingType.Number: {
      const numero = Number(stored);
      if (stored.trim() === '' || !Number.isFinite(numero)) {
        throw new Error(`Configuracao NUMBER com valor invalido no banco: "${stored}"`);
      }
      return numero;
    }
    case SystemSettingType.Boolean: {
      if (stored !== 'true' && stored !== 'false') {
        throw new Error(`Configuracao BOOLEAN com valor invalido no banco: "${stored}"`);
      }
      return stored === 'true';
    }
  }
}

/** Descricao curta do que veio, para a mensagem de erro - nunca o valor em si. */
function describe(raw: unknown): string {
  if (raw === null) {
    return 'null';
  }
  return Array.isArray(raw) ? 'lista' : typeof raw;
}
