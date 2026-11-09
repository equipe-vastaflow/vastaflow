/**
 * Mascaramento de dados pessoais nas respostas HTTP do Plantae (painel).
 *
 * Aplicado no CONTROLLER, antes de a resposta sair do backend: mascarar so na
 * interface seria cosmetico, porque o valor completo continuaria visivel na aba
 * Rede do navegador. O servico e os parsers continuam com o dado integral (o
 * comando de chat `/contas_pagar` nao passa por aqui).
 *
 * A busca e por NOME DE CHAVE, em qualquer nivel do objeto, e nao por caminho
 * fixo: o documento aparece em `pessoa` (lancamentos, movimentacoes, extrato),
 * em `emitente`/`destinatario` (NF-e), no cadastro de pessoas e de razoes sociais,
 * e pode aparecer dentro de campos de forma nao documentada (`PlantaeOpaque`).
 * So as chaves listadas abaixo mudam: valores, saldos, datas e identificadores
 * tecnicos (`pessoa_id`, `conta_id`...) saem intactos.
 *
 * Regra de seguranca: o valor original NUNCA e devolvido. Formato inesperado vira
 * mascara total, nao o texto recebido.
 */

/** Chaves que trazem CPF ou CNPJ. `cpf`/`cnpj` cobrem campos opacos. */
const DOCUMENT_KEYS: ReadonlySet<string> = new Set(['cpf_cnpj', 'cpf', 'cnpj']);
/** Chaves que trazem o numero de uma conta bancaria. */
const ACCOUNT_NUMBER_KEYS: ReadonlySet<string> = new Set(['numero_conta']);

const FULL_DOCUMENT_MASK = '***';
const FULL_ACCOUNT_MASK = '****';
const VISIBLE_ACCOUNT_CHARS = 4;

/** Texto de entrada ou `undefined` quando o valor nao e texto nem numero. */
function asText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * CPF (11 digitos) -> `***.456.789-**` (padrao gov.br: so os 6 digitos centrais).
 * CNPJ (14 digitos) -> `12.345.678/****-**` (so a raiz, que identifica a empresa).
 * Pontuacao de entrada e ignorada. `null` continua `null` e texto vazio continua
 * vazio (nao ha dado a esconder); qualquer outro formato vira `***`.
 */
export function maskDocument(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = asText(value);
  if (text === undefined) {
    return FULL_DOCUMENT_MASK;
  }
  if (text.trim() === '') {
    return '';
  }
  const digits = text.replace(/\D/g, '');
  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/****-**`;
  }
  return FULL_DOCUMENT_MASK;
}

/**
 * Numero de conta -> `****` + os ultimos 4 caracteres alfanumericos (o digito
 * verificador pode ser `X`). Com 4 caracteres ou menos, mostrar "os ultimos 4"
 * seria mostrar tudo: vira so `****`. `null` continua `null`; vazio continua vazio.
 */
export function maskAccountNumber(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = asText(value);
  if (text === undefined) {
    return FULL_ACCOUNT_MASK;
  }
  if (text.trim() === '') {
    return '';
  }
  const chars = text.replace(/[^0-9A-Za-z]/g, '');
  if (chars.length <= VISIBLE_ACCOUNT_CHARS) {
    return FULL_ACCOUNT_MASK;
  }
  return `${FULL_ACCOUNT_MASK}${chars.slice(-VISIBLE_ACCOUNT_CHARS)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Copia profunda com CPF/CNPJ e numero de conta mascarados. Nao altera a entrada.
 * O tipo de retorno e o mesmo da entrada: as chaves mascaradas ja sao
 * `string | null` no contrato.
 */
export function maskSensitive<T>(value: T): T {
  return maskValue(value) as T;
}

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (DOCUMENT_KEYS.has(key)) {
      result[key] = maskDocument(item);
    } else if (ACCOUNT_NUMBER_KEYS.has(key)) {
      result[key] = maskAccountNumber(item);
    } else {
      result[key] = maskValue(item);
    }
  }
  return result;
}
