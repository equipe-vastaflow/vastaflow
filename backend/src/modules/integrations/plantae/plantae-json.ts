import { PlantaeApiError } from './plantae-errors';
import { isCalendarDate } from './plantae-dates';

/**
 * Numero JSON com o TEXTO original preservado.
 *
 * `JSON.parse` converte `8337.10` em `8337.1` e `0.1 + 0.2` mostra o resto: um
 * `double` nao representa dinheiro. O `reviver` com `context.source` (Node 21+;
 * o projeto exige >= 24) entrega o texto exato do numero, e e dele que sai o
 * valor decimal - sem passar por ponto flutuante e sem arredondar.
 */
export class PlantaeNumber {
  constructor(readonly source: string) {}
}

type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

/**
 * `JSON.parse` que troca cada numero por um `PlantaeNumber`. Texto que nao e JSON
 * valido (ou numero sem texto-fonte) vira `invalid-response`, sem repetir o texto.
 */
export function parsePlantaeJson(text: string): unknown {
  const reviver: Reviver = (_key, value, context) => {
    if (typeof value !== 'number') {
      return value;
    }
    if (context?.source === undefined) {
      throw new PlantaeApiError('invalid-response', { where: 'json [numero sem texto-fonte]' });
    }
    return new PlantaeNumber(context.source);
  };
  try {
    const parsed: unknown = JSON.parse(text, reviver);
    return parsed;
  } catch (error) {
    if (error instanceof PlantaeApiError) {
      throw error;
    }
    throw new PlantaeApiError('invalid-response', { where: 'json [malformado]' });
  }
}

/** Valor monetario ou quantidade como TEXTO decimal exato (`"8337.10"`). Nunca `number`. */
export type Decimal = string;

/** Estrutura sem forma documentada na colecao (so apareceu `null`): preservada, sem interpretar. */
export type PlantaeOpaque =
  string | number | boolean | null | PlantaeOpaque[] | { [key: string]: PlantaeOpaque };

/** Valor codificado da API: `{ "codigo": ..., "descricao": "..." }`. */
export interface CodedValue<C extends string | number> {
  readonly codigo: C;
  readonly descricao: string | null;
}

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const INTEGER = /^-?\d+$/;
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const MAX_OPAQUE_DEPTH = 6;

/** Violacao do contrato: so o CAMINHO e o que era esperado, nunca o valor recebido. */
function violation(path: string, expected: string): PlantaeApiError {
  return new PlantaeApiError('invalid-response', { where: `${path} [${expected}]` });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof PlantaeNumber)
  );
}

function toOpaque(value: unknown, path: string, depth: number): PlantaeOpaque {
  if (depth > MAX_OPAQUE_DEPTH) {
    throw violation(path, 'profundidade');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof PlantaeNumber) {
    const asNumber = Number(value.source);
    return Number.isFinite(asNumber) && String(asNumber) === value.source ? asNumber : value.source;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown, index) =>
      toOpaque(item, `${path}[${String(index)}]`, depth + 1),
    );
  }
  if (isPlainObject(value)) {
    const result: { [key: string]: PlantaeOpaque } = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = toOpaque(item, `${path}.${key}`, depth + 1);
    }
    return result;
  }
  throw violation(path, 'json');
}

/**
 * Leitor de um objeto JSON recebido do Plantae.
 *
 * Todo acesso valida o tipo e, se violar o contrato, lanca `invalid-response`
 * com o caminho do campo (`data[2].valor [decimal]`) - o valor nao entra no
 * erro. Uma chave AUSENTE tambem e violacao: a colecao diz que "campo sem valor
 * vem `null` e nunca some da resposta".
 *
 * So le o que o contrato documenta: campos extras sao ignorados e nao passam
 * adiante (menos dado do cliente em memoria e nas respostas).
 */
export class JsonObject {
  private constructor(
    private readonly record: Record<string, unknown>,
    readonly path: string,
  ) {}

  static from(value: unknown, path: string): JsonObject {
    if (!isPlainObject(value)) {
      throw violation(path, 'objeto');
    }
    return new JsonObject(value, path);
  }

  private at(key: string): string {
    return this.path === '' ? key : `${this.path}.${key}`;
  }

  private raw(key: string): unknown {
    if (!Object.hasOwn(this.record, key)) {
      throw violation(this.at(key), 'ausente');
    }
    return this.record[key];
  }

  has(key: string): boolean {
    return Object.hasOwn(this.record, key);
  }

  string(key: string): string {
    const value = this.raw(key);
    if (typeof value !== 'string') {
      throw violation(this.at(key), 'texto');
    }
    return value;
  }

  nullableString(key: string): string | null {
    return this.raw(key) === null ? null : this.string(key);
  }

  boolean(key: string): boolean {
    const value = this.raw(key);
    if (typeof value !== 'boolean') {
      throw violation(this.at(key), 'booleano');
    }
    return value;
  }

  int(key: string): number {
    const value = this.raw(key);
    if (
      !(value instanceof PlantaeNumber) ||
      !INTEGER.test(value.source) ||
      !Number.isSafeInteger(Number(value.source))
    ) {
      throw violation(this.at(key), 'inteiro');
    }
    return Number(value.source);
  }

  nullableInt(key: string): number | null {
    return this.raw(key) === null ? null : this.int(key);
  }

  /**
   * Decimal exato, como o texto que a API enviou. Notacao cientifica e recusada
   * (`1e3`): nao ha como garantir o mesmo valor sem converter. NAO impoe "ate 2
   * casas" - o texto da colecao diz isso, mas os exemplos trazem mais, e
   * arredondar em silencio seria pior que preservar.
   */
  decimal(key: string): Decimal {
    const value = this.raw(key);
    if (!(value instanceof PlantaeNumber) || !DECIMAL.test(value.source)) {
      throw violation(this.at(key), 'decimal');
    }
    return value.source;
  }

  nullableDecimal(key: string): Decimal | null {
    return this.raw(key) === null ? null : this.decimal(key);
  }

  /** Campo que o Plantae manda como numero OU texto (numero de documento, cheque, CFOP): vira texto. */
  looseNumber(key: string): string | null {
    const value = this.raw(key);
    if (value === null) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof PlantaeNumber && INTEGER.test(value.source)) {
      return value.source;
    }
    throw violation(this.at(key), 'numero ou texto');
  }

  date(key: string): string {
    const value = this.string(key);
    if (!isCalendarDate(value)) {
      throw violation(this.at(key), 'data');
    }
    return value;
  }

  nullableDate(key: string): string | null {
    return this.raw(key) === null ? null : this.date(key);
  }

  dateTime(key: string): string {
    const value = this.string(key);
    const match = DATE_TIME.exec(value);
    if (!match || !isCalendarDate(match[1] ?? '')) {
      throw violation(this.at(key), 'data-hora');
    }
    return value;
  }

  nullableDateTime(key: string): string | null {
    return this.raw(key) === null ? null : this.dateTime(key);
  }

  object(key: string): JsonObject {
    return JsonObject.from(this.raw(key), this.at(key));
  }

  nullableObject(key: string): JsonObject | null {
    return this.raw(key) === null ? null : this.object(key);
  }

  objectArray(key: string): JsonObject[] {
    const value = this.raw(key);
    if (!Array.isArray(value)) {
      throw violation(this.at(key), 'lista');
    }
    return value.map((item: unknown, index) =>
      JsonObject.from(item, `${this.at(key)}[${String(index)}]`),
    );
  }

  stringArray(key: string): string[] {
    const value = this.raw(key);
    if (!Array.isArray(value)) {
      throw violation(this.at(key), 'lista');
    }
    return value.map((item: unknown, index) => {
      if (typeof item !== 'string') {
        throw violation(`${this.at(key)}[${String(index)}]`, 'texto');
      }
      return item;
    });
  }

  opaque(key: string): PlantaeOpaque {
    return toOpaque(this.raw(key), this.at(key), 0);
  }

  /** `{ codigo, descricao }` com `codigo` inteiro. */
  numericCode(key: string): CodedValue<number> {
    const obj = this.object(key);
    return { codigo: obj.int('codigo'), descricao: obj.nullableString('descricao') };
  }

  nullableNumericCode(key: string): CodedValue<number> | null {
    return this.raw(key) === null ? null : this.numericCode(key);
  }

  /** `{ codigo, descricao }` com `codigo` em texto (ex.: `"C"`, `"0"`). */
  textCode(key: string): CodedValue<string> {
    const obj = this.object(key);
    return { codigo: obj.string('codigo'), descricao: obj.nullableString('descricao') };
  }

  nullableTextCode(key: string): CodedValue<string> | null {
    return this.raw(key) === null ? null : this.textCode(key);
  }
}

/** Lista na raiz (`data`) ou em qualquer ponto, com o caminho certo nos erros. */
export function readEnvelope(body: unknown): JsonObject {
  return JsonObject.from(body, '');
}
