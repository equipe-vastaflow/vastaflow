import { createHash } from 'node:crypto';
import { canonicalJson, type NfseFiscalSnapshot } from './nfse-fiscal-profile';
import { moneyToCents, normalizeMoney, type NfseSettings } from './nfse-settings';

/**
 * Entrada fiscal de UMA emissao, ja validada. NADA aqui e inferido: tributacao, local da prestacao,
 * retencao e codigo do servico sao informados pela pessoa e confirmados no resumo. Campos que a
 * cliente ainda nao decidiu simplesmente nao existem (ver `docs/nfse.md`).
 */
export interface NfseEmissionInput {
  readonly tomadorDoc: string;
  readonly tomadorTipo: 'CPF' | 'CNPJ';
  readonly tomadorNome: string;
  /** Texto decimal exato com 2 casas (`1500.00`). Nunca `number`. */
  readonly valor: string;
  /** `cTribNac`: 6 digitos da lista nacional de servicos. */
  readonly servico: string;
  readonly descricao: string;
  /** `tribISSQN`: 1 = tributavel, 4 = nao incidencia (2 e 3 exigem dados extras: nao suportados). */
  readonly tribIssqn: 1 | 4;
  /** `tpRetISSQN`: 1 = nao retido, 2 = retido pelo tomador, 3 = retido pelo intermediario. */
  readonly tpRetIssqn: 1 | 2 | 3;
  /** `cLocPrestacao`: codigo IBGE do local da prestacao. */
  readonly localPrestacao: string;
  /** `pAliq` em % com 2 casas (`2.50`), opcional: o municipio conveniado a fornece. */
  readonly aliquota: string | null;
  /** `pTotTribSN`: percentual aproximado de tributos, so ME/EPP (`opSimpNac = 3`). */
  readonly totTribSimples: string | null;
  /** `dCompet`, AAAA-MM-DD. */
  readonly competencia: string;
  /**
   * Endereco nacional do tomador (`toma/end`). So existe quando o perfil fiscal o exige (nao optante).
   * Ausente em registros anteriores a esta versao: tratar `undefined` como `null`.
   */
  readonly tomadorEndereco?: NfseTomadorEndereco | null;
  /**
   * Perfil fiscal ja resolvido para ESTA emissao (nao optante: `cTribMun`, `cNBS`, retencoes federais, total
   * de tributos e IBS/CBS). `null`/ausente para ME/EPP, que segue o fluxo sem perfil.
   */
  readonly fiscal?: NfseFiscalSnapshot | null;
}

/** Endereco nacional do tomador (leiaute `TCEndereco` com `endNac`). */
export interface NfseTomadorEndereco {
  /** Codigo IBGE do municipio, 7 digitos. */
  readonly cMun: string;
  /** CEP, 8 digitos. */
  readonly cep: string;
  readonly logradouro: string;
  readonly numero: string;
  readonly complemento: string | null;
  readonly bairro: string;
}

export const DESCRIPTION_MAX = 2000;
export const NAME_MAX = 300;

const KEYS = [
  'tomador',
  'nome',
  'valor',
  'servico',
  'desc',
  'iss',
  'ret',
  'local',
  'aliq',
  'totsn',
  'competencia',
  // Endereco nacional do tomador, so quando o perfil fiscal o exige (ver `parseAddressArgs`).
  'cmun',
  'cep',
  'logradouro',
  'numero',
  'bairro',
  'compl',
] as const;
type FieldKey = (typeof KEYS)[number];

export type ParsedArgs =
  | { readonly ok: true; readonly fields: Partial<Record<FieldKey, string>> }
  | { readonly ok: false; readonly error: string };

/** Aspas tipograficas que o Telegram/WhatsApp podem inserir no lugar das retas. */
const normalizeQuotes = (value: string): string =>
  value.replace(/[\u201c\u201d\u201e\u201f]/g, '"');

/**
 * `campo=valor` separados por espaco; valores com espaco entre aspas (`desc="Consultoria mensal"`).
 * Um campo repetido, desconhecido ou sem valor e erro: nao se adivinha a intencao em dado fiscal.
 */
export function parseNfseArgs(rawArgs: string): ParsedArgs {
  const fields: Partial<Record<FieldKey, string>> = {};
  const source = normalizeQuotes(rawArgs).trim();
  const token = /([a-z]+)=("([^"]*)"|[^\s"]+)/gy;
  let position = 0;
  while (position < source.length) {
    if (/\s/.test(source[position] ?? '')) {
      position += 1;
      continue;
    }
    token.lastIndex = position;
    const match = token.exec(source);
    if (match === null) {
      return { ok: false, error: 'argumento fora do formato campo=valor' };
    }
    const key = match[1] as FieldKey;
    if (!KEYS.includes(key)) {
      return { ok: false, error: `campo desconhecido: ${String(match[1])}` };
    }
    if (fields[key] !== undefined) {
      return { ok: false, error: `campo repetido: ${key}` };
    }
    fields[key] = match[3] ?? match[2] ?? '';
    position = token.lastIndex;
  }
  return { ok: true, fields };
}

/** Digitos verificadores do CPF (11) e do CNPJ (14). */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) {
    return false;
  }
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(digits[i]) * (length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) {
    return false;
  }
  const check = (length: number): number => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(digits[i]) * (weights[i] ?? 0);
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

/** Caracteres de controle e quebras: a descricao e uma linha, e nada disso pertence a um XML fiscal. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const isRealDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};

/** Data de hoje no fuso de Brasilia (sem horario de verao desde 2019), AAAA-MM-DD. */
export function todayInBrasilia(now: Date): string {
  return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export type BuiltInput =
  | { readonly ok: true; readonly input: NfseEmissionInput }
  | { readonly ok: false; readonly errors: readonly string[] };

const percent = (raw: string, max: number, digitsBefore: 1 | 2): string | null => {
  const match = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(raw.trim());
  if (match === null || (match[1] ?? '').length > digitsBefore) {
    return null;
  }
  const value = `${String(Number(match[1]))}.${(match[2] ?? '').padEnd(2, '0')}`;
  return Number(value) > max ? null : value;
};

/**
 * Valida os campos e monta a entrada. Devolve TODOS os problemas de uma vez (a pessoa corrige numa
 * so mensagem). Nunca ecoa o valor invalido: as mensagens citam so o NOME do campo.
 */
export function buildNfseInput(
  fields: Partial<Record<FieldKey, string>>,
  settings: Pick<NfseSettings, 'opSimpNac' | 'regEspTrib' | 'valorMaximo'>,
  now: Date,
): BuiltInput {
  const errors: string[] = [];
  const need = (key: FieldKey): string => {
    const value = fields[key]?.trim() ?? '';
    if (value === '') {
      errors.push(`falta o campo ${key}`);
    }
    return value;
  };

  const docRaw = need('tomador').replace(/[.\-/]/g, '');
  let tomadorTipo: 'CPF' | 'CNPJ' = 'CPF';
  if (docRaw !== '') {
    if (isValidCpf(docRaw)) {
      tomadorTipo = 'CPF';
    } else if (isValidCnpj(docRaw)) {
      tomadorTipo = 'CNPJ';
    } else {
      errors.push('tomador: CPF ou CNPJ invalido');
    }
  }

  const nome = need('nome');
  if (nome !== '' && (nome.length > NAME_MAX || CONTROL.test(nome))) {
    errors.push(`nome: ate ${String(NAME_MAX)} caracteres, sem quebra de linha`);
  }

  const valorRaw = need('valor');
  const valor = valorRaw === '' ? null : normalizeMoney(valorRaw);
  if (valorRaw !== '' && valor === null) {
    errors.push('valor: use um numero como 1500 ou 1500,50');
  } else if (valor !== null) {
    const cents = moneyToCents(valor);
    if (cents <= 0n) {
      errors.push('valor: deve ser maior que zero');
    } else if (cents > moneyToCents(settings.valorMaximo)) {
      errors.push('valor: acima do limite por emissao configurado');
    }
  }

  const servico = need('servico');
  if (servico !== '' && !/^\d{6}$/.test(servico)) {
    errors.push('servico: codigo de tributacao nacional com 6 digitos');
  }

  const descricao = need('desc');
  if (descricao !== '' && (descricao.length > DESCRIPTION_MAX || CONTROL.test(descricao))) {
    errors.push(`desc: ate ${String(DESCRIPTION_MAX)} caracteres, em uma linha`);
  }

  const issRaw = need('iss');
  let tribIssqn: 1 | 4 = 1;
  if (issRaw === '1' || issRaw === '4') {
    tribIssqn = issRaw === '1' ? 1 : 4;
  } else if (issRaw === '2' || issRaw === '3') {
    errors.push('iss: imunidade e exportacao exigem dados adicionais ainda nao suportados');
  } else if (issRaw !== '') {
    errors.push('iss: use 1 (tributavel) ou 4 (nao incidencia)');
  }
  if (tribIssqn === 4 && settings.regEspTrib !== 0) {
    errors.push('iss: com regime especial de tributacao configurado so e permitido iss=1');
  }

  const retRaw = need('ret');
  let tpRetIssqn: 1 | 2 | 3 = 1;
  if (retRaw === '1' || retRaw === '2' || retRaw === '3') {
    tpRetIssqn = Number(retRaw) as 1 | 2 | 3;
  } else if (retRaw !== '') {
    errors.push(
      'ret: use 1 (nao retido), 2 (retido pelo tomador) ou 3 (retido pelo intermediario)',
    );
  }

  const localPrestacao = need('local');
  if (localPrestacao !== '' && !/^\d{7}$/.test(localPrestacao)) {
    errors.push('local: codigo IBGE do municipio com 7 digitos');
  }

  let aliquota: string | null = null;
  if (fields.aliq !== undefined) {
    aliquota = percent(fields.aliq, 5, 1);
    if (aliquota === null) {
      errors.push('aliq: percentual de 0 a 5, ate 2 casas');
    } else if (tribIssqn !== 1) {
      errors.push('aliq: so se aplica a operacao tributavel (iss=1)');
    }
  }

  let totTribSimples: string | null = null;
  if (settings.opSimpNac === 3) {
    // Para ME/EPP o indicador "nao informar" nao e permitido (regra E0712): o percentual e da cliente.
    const raw = fields.totsn?.trim() ?? '';
    totTribSimples = raw === '' ? null : percent(raw, 99.99, 2);
    if (totTribSimples === null) {
      errors.push('totsn: percentual aproximado de tributos (ME/EPP), de 0 a 99,99');
    }
  } else if (fields.totsn !== undefined) {
    errors.push('totsn: so se aplica a optante ME/EPP');
  }

  const today = todayInBrasilia(now);
  const competencia = fields.competencia?.trim() ?? today;
  if (!isRealDate(competencia)) {
    errors.push('competencia: use AAAA-MM-DD');
  } else if (competencia > today) {
    errors.push('competencia: nao pode ser futura');
  }

  if (errors.length > 0 || valor === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    input: {
      tomadorDoc: docRaw,
      tomadorTipo,
      tomadorNome: nome,
      valor,
      servico,
      descricao,
      tribIssqn,
      tpRetIssqn,
      localPrestacao,
      aliquota,
      totTribSimples,
      competencia,
    },
  };
}

/** Mascara para exibir documento: nunca o numero inteiro em chat. */
export function maskDocument(doc: string): string {
  return doc.length === 11 ? `***.${doc.slice(3, 6)}.***-**` : `**.***.${doc.slice(5, 8)}/****-**`;
}

const TRIB_LABEL: Record<1 | 4, string> = { 1: 'tributavel', 4: 'nao incidencia' };
const RET_LABEL: Record<1 | 2 | 3, string> = {
  1: 'ISS nao retido',
  2: 'ISS retido pelo tomador',
  3: 'ISS retido pelo intermediario',
};

/** `1500.00` -> `R$ 1.500,00`, sem `number`. */
export function formatBrl(decimal: string): string {
  const [whole = '0', cents = '00'] = decimal.split('.');
  return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`;
}

/**
 * Resumo fiscal mostrado a quem vai confirmar. E TAMBEM o que se assina: o hash deste texto fica
 * gravado com o pedido, entao o que foi confirmado e exatamente o que foi mostrado.
 */
export function summarizeInput(
  input: NfseEmissionInput,
  context: { readonly ambiente: 'restrita' | 'producao'; readonly numero: number },
): string {
  return [
    `NFS-e (DPS no ${String(context.numero)}) - ambiente: ${context.ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO'}`,
    `Tomador: ${input.tomadorNome} (${maskDocument(input.tomadorDoc)})`,
    `Servico: ${input.servico} - ${input.descricao}`,
    `Valor: ${formatBrl(input.valor)}`,
    `ISSQN: ${TRIB_LABEL[input.tribIssqn]}, ${RET_LABEL[input.tpRetIssqn]}${input.aliquota === null ? ', aliquota do municipio' : `, aliquota ${input.aliquota.replace('.', ',')}%`}`,
    `Local da prestacao (IBGE): ${input.localPrestacao}`,
    `Competencia: ${input.competencia.split('-').reverse().join('/')}`,
    ...fiscalSummaryLines(input),
  ].join('\n');
}

const ADDRESS_KEYS = ['cMun', 'cep', 'logradouro', 'numero', 'complemento', 'bairro'];

export type AddressResult =
  | { readonly ok: true; readonly endereco: NfseTomadorEndereco }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Valida o endereco do tomador, como chega de fora (nada e presumido; so os limites do esquema:
 * logradouro ate 255, numero e bairro ate 60, complemento opcional). Mensagens citam so o NOME do campo.
 */
export function validateTomadorEndereco(raw: unknown): AddressResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['endereco do tomador: formato invalido'] };
  }
  const data = raw as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!ADDRESS_KEYS.includes(key)) {
      errors.push(`endereco do tomador: campo desconhecido ${key}`);
    }
  }
  const text = (key: string, max: number, optional = false): string | null => {
    const value = data[key];
    if (optional && (value === undefined || value === null || value === '')) {
      return null;
    }
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.length > max ||
      CONTROL.test(value)
    ) {
      errors.push(`endereco do tomador: ${key} invalido`);
      return null;
    }
    return value.trim();
  };
  const digits = (key: string, length: number): string => {
    const value = data[key];
    if (typeof value !== 'string' || !new RegExp(`^\\d{${String(length)}}$`).test(value)) {
      errors.push(`endereco do tomador: ${key} deve ter ${String(length)} digitos`);
      return '';
    }
    return value;
  };
  const cMun = digits('cMun', 7);
  const cep = digits('cep', 8);
  const logradouro = text('logradouro', 255);
  const numero = text('numero', 60);
  const complemento = text('complemento', 156, true);
  const bairro = text('bairro', 60);
  if (errors.length > 0 || logradouro === null || numero === null || bairro === null) {
    return { ok: false, errors };
  }
  return { ok: true, endereco: { cMun, cep, logradouro, numero, complemento, bairro } };
}

/** Nomes dos argumentos do comando para cada campo do endereco (as mensagens citam o que a pessoa digitou). */
const ADDRESS_ARG: Record<string, string> = {
  cMun: 'cmun',
  cep: 'cep',
  logradouro: 'logradouro',
  numero: 'numero',
  complemento: 'compl',
  bairro: 'bairro',
};
const ADDRESS_ARG_NAMES = ['cmun', 'cep', 'logradouro', 'numero', 'bairro', 'compl'] as const;

export type AddressArgs =
  | { readonly ok: true; readonly endereco: NfseTomadorEndereco | null }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Endereco do tomador a partir dos argumentos do comando (`cmun=`, `cep=`, `logradouro=`, `numero=`, `bairro=`,
 * `compl=`). Nenhum informado = sem endereco (`null`). Qualquer um informado exige os obrigatorios: endereco
 * pela metade nao e aceito. CEP aceita `30000-000` e `30.000-000`. Mensagens citam o NOME do argumento.
 */
export function parseAddressArgs(fields: Partial<Record<FieldKey, string>>): AddressArgs {
  if (ADDRESS_ARG_NAMES.every((key) => fields[key] === undefined)) {
    return { ok: true, endereco: null };
  }
  const result = validateTomadorEndereco({
    cMun: fields.cmun?.trim() ?? '',
    cep: (fields.cep ?? '').replace(/[.\-\s]/g, ''),
    logradouro: fields.logradouro ?? '',
    numero: fields.numero ?? '',
    complemento: fields.compl ?? '',
    bairro: fields.bairro ?? '',
  });
  if (result.ok) {
    return { ok: true, endereco: result.endereco };
  }
  const rename = (message: string): string =>
    message.replace(
      /endereco do tomador: (\w+)/,
      (_whole, key: string) => `endereco do tomador: ${ADDRESS_ARG[key] ?? key}`,
    );
  return { ok: false, errors: result.errors.map(rename) };
}

/**
 * Impressao digital da CONFIRMACAO: resumo mostrado + TODO o conteudo fiscal gravado no pedido (inclusive o que o
 * resumo nao exibe: endereco completo, indicadores, valores calculados). E o que fica guardado ao criar o pedido
 * e e reconferido ao confirmar: qualquer alteracao fiscal depois do pedido a invalida.
 */
export function confirmationFingerprint(
  input: NfseEmissionInput,
  context: { readonly ambiente: 'restrita' | 'producao'; readonly numero: number },
): string {
  return hashText(`${summarizeInput(input, context)}\n${canonicalJson(input)}`);
}

/** Referencia curta (8 hex) de um conteudo: amarra ao hash do resumo o que o resumo nao mostra por inteiro. */
export function shortRef(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 8);
}

const brDate = (iso: string): string => iso.split('-').reverse().join('/');

/** Linhas do resumo para uma emissao com perfil fiscal (nao optante). Vazio para ME/EPP. */
function fiscalSummaryLines(input: NfseEmissionInput): string[] {
  const fiscal = input.fiscal;
  if (fiscal === null || fiscal === undefined) {
    return [];
  }
  const ib = fiscal.ibscbs;
  const lines = [
    `Perfil fiscal: ${fiscal.perfil.id} v${String(fiscal.perfil.versao)} (aprovado por ${fiscal.perfil.aprovadoPor} em ${brDate(fiscal.perfil.aprovadoEm)}; ref. ${fiscal.perfil.conteudoSha256.slice(0, 8)})`,
    `Codigos: cTribNac ${input.servico}, cTribMun ${fiscal.cTribMun ?? '-'}, NBS ${fiscal.cNBS}`,
    `IBS/CBS: CST ${ib.cst}, cClassTrib ${ib.cClassTrib}, cIndOp ${ib.cIndOp}, indDest ${String(ib.indDest)}${ib.tpOper === null ? '' : `, tpOper ${String(ib.tpOper)}`}${ib.tpEnteGov === null ? '' : `, tpEnteGov ${String(ib.tpEnteGov)}`}`,
  ];
  const fed = fiscal.tribFed;
  const parts: string[] = [];
  if (fed?.piscofins) {
    parts.push(`PIS/COFINS CST ${fed.piscofins.cst}`);
  }
  for (const [label, value] of [
    ['IRRF', fed?.vRetIRRF],
    ['CSLL', fed?.vRetCSLL],
    ['CP', fed?.vRetCP],
  ] as const) {
    if (value !== null && value !== undefined) {
      parts.push(`${label} ${formatBrl(value)}`);
    }
  }
  lines.push(`Tributos federais: ${parts.length === 0 ? 'sem retencao' : parts.join(', ')}`);
  const tot = fiscal.totTrib;
  const totText =
    tot.tipo === 'indicador'
      ? 'nao informado'
      : tot.tipo === 'percentuais'
        ? `federal ${tot.fed}%, estadual ${tot.est}%, municipal ${tot.mun}%`
        : `federal ${formatBrl(tot.fed)}, estadual ${formatBrl(tot.est)}, municipal ${formatBrl(tot.mun)}`;
  lines.push(`Total aproximado de tributos: ${totText}`);
  if (input.tomadorEndereco !== null && input.tomadorEndereco !== undefined) {
    lines.push(
      `Endereco do tomador: municipio ${input.tomadorEndereco.cMun}, CEP ${input.tomadorEndereco.cep.slice(0, 5)}-*** (ref. ${shortRef(input.tomadorEndereco)})`,
    );
  }
  return lines;
}

export function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
