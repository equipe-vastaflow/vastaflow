import { createHash } from 'node:crypto';

/**
 * PERFIS FISCAIS por servico (empresa NAO optante pelo Simples Nacional).
 *
 * Um perfil reune o que a CONTADORA decide para um servico: codigos (`cTribNac`, `cTribMun`, `cNBS`), a
 * tributacao do IBS/CBS, o que se retem na esfera federal e o total aproximado de tributos. Nada daqui e
 * padrao do sistema: o codigo NAO traz perfil nenhum (a unica amostra esta em testes, com valores
 * SINTETICOS). Os perfis reais vivem num arquivo fora do repositorio (`NFSE_PERFIS_FISCAIS_PATH`), como o
 * certificado.
 *
 * Versionamento e aprovacao:
 * - `id` + `versao`: cada mudanca de conteudo e uma NOVA versao; a versao mais alta de um `id` e a que vale
 *   (se ela nao estiver aprovada, o servico fica indisponivel: nunca se volta a uma versao anterior);
 * - `aprovacao.conteudoSha256` amarra a aprovacao ao CONTEUDO: o hash e calculado sobre o perfil sem o bloco
 *   `aprovacao` (JSON canonico). Alterou um codigo depois da aprovacao, o hash nao confere e o perfil deixa de
 *   valer ate ser aprovado de novo.
 *
 * Emissao so com perfil COMPLETO, valido e APROVADO. Mensagens de erro citam o NOME do campo, nunca o valor.
 */

export type NfseProfileStatus = 'rascunho' | 'aprovado' | 'revogado';

export interface NfseProfileApproval {
  readonly status: NfseProfileStatus;
  readonly aprovadoPor: string | null;
  /** AAAA-MM-DD. */
  readonly aprovadoEm: string | null;
  readonly conteudoSha256: string | null;
}

export type NfseTotTribProfile =
  | { readonly tipo: 'indicador' }
  | {
      readonly tipo: 'percentuais';
      readonly fed: string;
      readonly est: string;
      readonly mun: string;
    }
  | { readonly tipo: 'valores'; readonly fed: string; readonly est: string; readonly mun: string };

export interface NfseFiscalProfile {
  readonly id: string;
  readonly versao: number;
  readonly descricao: string;
  readonly servico: {
    /** `cTribNac`, 6 digitos. Chave de selecao do perfil. */
    readonly cTribNac: string;
    /** `cTribMun`, 3 digitos; `null` quando o municipio nao exige. */
    readonly cTribMun: string | null;
    /** `cNBS`, 9 digitos (Anexo B). */
    readonly cNBS: string;
  };
  /** O que a emissao pode pedir (`iss=`, `ret=`): fora disso o pedido e recusado. */
  readonly permitidos: {
    readonly tribIssqn: readonly (1 | 4)[];
    readonly tpRetIssqn: readonly (1 | 2 | 3)[];
  };
  readonly tomador: {
    /** Se a contadora exige o endereco do tomador na DPS (depende de `indDest` e do `cIndOp`). */
    readonly exigeEndereco: boolean;
  };
  readonly tribFed: {
    readonly piscofins: { readonly cst: string; readonly tpRetPisCofins: string | null } | null;
    /** Percentuais (0 a 100, 2 casas) aplicados ao valor do servico. `null` = nao retem. */
    readonly retencoes: {
      readonly cpPct: string | null;
      readonly irrfPct: string | null;
      readonly csllPct: string | null;
    } | null;
  } | null;
  readonly totTrib: NfseTotTribProfile;
  readonly ibscbs: {
    readonly indDest: 0 | 1;
    /** `cIndOp`, 6 digitos (Anexo C). */
    readonly cIndOp: string;
    /** `indFinal`: sera descontinuado pela NT 005; `null` = nao informar. */
    readonly indFinal: 0 | 1 | null;
    readonly tpOper: 1 | 2 | 3 | 4 | 5 | null;
    readonly tpEnteGov: 1 | 2 | 3 | 4 | null;
    /** `CST`, 3 digitos. */
    readonly cst: string;
    /** `cClassTrib`, 6 digitos. */
    readonly cClassTrib: string;
  };
  readonly aprovacao: NfseProfileApproval;
}

/** Perfil ja resolvido para UMA emissao: o que e gravado com o pedido e usado para gerar a DPS. */
export interface NfseFiscalSnapshot {
  readonly perfil: {
    readonly id: string;
    readonly versao: number;
    readonly conteudoSha256: string;
    readonly aprovadoPor: string;
    readonly aprovadoEm: string;
  };
  readonly cTribMun: string | null;
  readonly cNBS: string;
  readonly exigeEnderecoTomador: boolean;
  readonly tribFed: {
    readonly piscofins: { readonly cst: string; readonly tpRetPisCofins: string | null } | null;
    readonly vRetCP: string | null;
    readonly vRetIRRF: string | null;
    readonly vRetCSLL: string | null;
  } | null;
  readonly totTrib: NfseTotTribProfile;
  readonly ibscbs: NfseFiscalProfile['ibscbs'];
}

// ---------------------------------------------------------------------------------------------------
// Conteudo canonico e hash de aprovacao
// ---------------------------------------------------------------------------------------------------

/** JSON com chaves em ordem alfabetica, em todos os niveis: mesma entrada, mesma saida. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 do conteudo do perfil SEM o bloco `aprovacao`: e o que a contadora aprova. */
export function profileContentHash(
  profile: NfseFiscalProfile | Omit<NfseFiscalProfile, 'aprovacao'>,
): string {
  const { id, versao, descricao, servico, permitidos, tomador, tribFed, totTrib, ibscbs } = profile;
  return createHash('sha256')
    .update(
      canonicalJson({
        id,
        versao,
        descricao,
        servico,
        permitidos,
        tomador,
        tribFed,
        totTrib,
        ibscbs,
      }),
      'utf8',
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------------------------------
// Leitura e validacao do arquivo de perfis
// ---------------------------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const PCT = /^\d{1,3}(\.\d{2})?$/;
const SEPARATORS = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
/** Caracteres de controle e quebras de linha: nada disso pertence a um texto fiscal de uma linha. */
const hasControl = (value: string): boolean =>
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f]/.test(value) || SEPARATORS.some((sep) => value.includes(sep));
const CST_PIS = new Set(
  '00 01 02 03 04 05 06 07 08 09 49 50 51 52 53 54 55 56 60 61 62 63 64 65 66 67 70 71 72 73 74 75 98 99'.split(
    ' ',
  ),
);

const isRealDate = (value: string): boolean => {
  if (!DATE.test(value)) {
    return false;
  }
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
};

/** Percentual `d`, `d.dd` ... ate 100,00 -> texto canonico `N.NN`; `null` se invalido. */
export function normalizePercent(raw: unknown): string | null {
  if (typeof raw !== 'string' || !PCT.test(raw)) {
    return null;
  }
  const [whole = '0', cents = '00'] = raw.split('.');
  const value = `${String(Number(whole))}.${cents.padEnd(2, '0')}`;
  return Number(value) > 100 ? null : value;
}

export interface ParsedProfiles {
  readonly perfis: readonly NfseFiscalProfile[];
  readonly problems: readonly string[];
}

const TOP_KEYS = ['versaoEsquema', 'perfis'];
const PROFILE_KEYS = [
  'id',
  'versao',
  'descricao',
  'servico',
  'permitidos',
  'tomador',
  'tribFed',
  'totTrib',
  'ibscbs',
  'aprovacao',
];

/**
 * Valida o arquivo de perfis. Estrito: campo desconhecido, ausente ou fora do formato e problema (nada e
 * presumido). Perfis com problema NAO entram em `perfis`. Os problemas citam o `id` e o campo, nunca o valor.
 */
export function parseFiscalProfiles(raw: unknown): ParsedProfiles {
  const problems: string[] = [];
  if (!isObject(raw)) {
    return { perfis: [], problems: ['arquivo de perfis fiscais: formato invalido'] };
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) {
      problems.push(`arquivo: campo desconhecido '${key}'`);
    }
  }
  if (raw.versaoEsquema !== 1) {
    problems.push('arquivo: versaoEsquema deve ser 1');
  }
  if (!Array.isArray(raw.perfis)) {
    return { perfis: [], problems: [...problems, 'arquivo: perfis deve ser uma lista'] };
  }

  const perfis: NfseFiscalProfile[] = [];
  const seen = new Set<string>();
  raw.perfis.forEach((item: unknown, index: number) => {
    const label =
      isObject(item) && typeof item.id === 'string' && ID.test(item.id)
        ? item.id
        : `#${String(index + 1)}`;
    const found: string[] = [];
    const profile = parseProfile(item, found);
    for (const message of found) {
      problems.push(`perfil ${label}: ${message}`);
    }
    if (profile !== null && found.length === 0) {
      const key = `${profile.id}@${String(profile.versao)}`;
      if (seen.has(key)) {
        problems.push(`perfil ${label}: id e versao repetidos`);
        return;
      }
      seen.add(key);
      perfis.push(profile);
    }
  });
  return { perfis, problems };
}

function parseProfile(item: unknown, errors: string[]): NfseFiscalProfile | null {
  if (!isObject(item)) {
    errors.push('formato invalido');
    return null;
  }
  for (const key of Object.keys(item)) {
    if (!PROFILE_KEYS.includes(key)) {
      errors.push(`campo desconhecido '${key}'`);
    }
  }
  const text = (value: unknown, field: string, max: number): string => {
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.length > max ||
      hasControl(value)
    ) {
      errors.push(`${field} invalido`);
      return '';
    }
    return value;
  };
  const digits = (value: unknown, field: string, length: number): string => {
    if (typeof value !== 'string' || !new RegExp(`^\\d{${String(length)}}$`).test(value)) {
      errors.push(`${field} deve ter ${String(length)} digitos`);
      return '';
    }
    return value;
  };
  const only = <T extends number>(
    value: unknown,
    allowed: readonly T[],
    field: string,
  ): T | null => {
    const found = allowed.find((option) => option === value);
    if (found === undefined) {
      errors.push(`${field} invalido`);
      return null;
    }
    return found;
  };
  const object = (
    value: unknown,
    field: string,
    keys: readonly string[],
  ): Record<string, unknown> => {
    if (!isObject(value)) {
      errors.push(`${field} ausente ou invalido`);
      return {};
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        errors.push(`${field}: campo desconhecido '${key}'`);
      }
    }
    return value;
  };

  const id = typeof item.id === 'string' && ID.test(item.id) ? item.id : '';
  if (id === '') {
    errors.push('id invalido (3 a 40 caracteres: letras minusculas, numeros e hifen)');
  }
  const versao =
    typeof item.versao === 'number' && Number.isInteger(item.versao) && item.versao >= 1
      ? item.versao
      : 0;
  if (versao === 0) {
    errors.push('versao deve ser um inteiro a partir de 1');
  }
  const descricao = text(item.descricao, 'descricao', 200);

  const servicoRaw = object(item.servico, 'servico', ['cTribNac', 'cTribMun', 'cNBS']);
  const cTribNac = digits(servicoRaw.cTribNac, 'servico.cTribNac', 6);
  const cTribMun =
    servicoRaw.cTribMun === null || servicoRaw.cTribMun === undefined
      ? null
      : digits(servicoRaw.cTribMun, 'servico.cTribMun', 3);
  const cNBS = digits(servicoRaw.cNBS, 'servico.cNBS', 9);

  const permRaw = object(item.permitidos, 'permitidos', ['tribIssqn', 'tpRetIssqn']);
  const listOf = <T extends number>(value: unknown, allowed: readonly T[], field: string): T[] => {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`${field} deve ser uma lista nao vazia`);
      return [];
    }
    const out: T[] = [];
    for (const entry of value as unknown[]) {
      const ok = only(entry, allowed, field);
      if (ok !== null && !out.includes(ok)) {
        out.push(ok);
      }
    }
    return out;
  };
  const tribIssqn = listOf<1 | 4>(permRaw.tribIssqn, [1, 4], 'permitidos.tribIssqn');
  const tpRetIssqn = listOf<1 | 2 | 3>(permRaw.tpRetIssqn, [1, 2, 3], 'permitidos.tpRetIssqn');

  const tomadorRaw = object(item.tomador, 'tomador', ['exigeEndereco']);
  if (typeof tomadorRaw.exigeEndereco !== 'boolean') {
    errors.push('tomador.exigeEndereco deve ser verdadeiro ou falso');
  }

  let tribFed: NfseFiscalProfile['tribFed'] = null;
  if (item.tribFed !== null) {
    const fedRaw = object(item.tribFed, 'tribFed', ['piscofins', 'retencoes']);
    let piscofins: NonNullable<NfseFiscalProfile['tribFed']>['piscofins'] = null;
    if (fedRaw.piscofins !== null && fedRaw.piscofins !== undefined) {
      const pc = object(fedRaw.piscofins, 'tribFed.piscofins', ['cst', 'tpRetPisCofins']);
      const cst = typeof pc.cst === 'string' && CST_PIS.has(pc.cst) ? pc.cst : '';
      if (cst === '') {
        errors.push('tribFed.piscofins.cst invalido');
      }
      const ret =
        pc.tpRetPisCofins === null || pc.tpRetPisCofins === undefined
          ? null
          : typeof pc.tpRetPisCofins === 'string' && /^[0-9]$/.test(pc.tpRetPisCofins)
            ? pc.tpRetPisCofins
            : (errors.push('tribFed.piscofins.tpRetPisCofins invalido'), null);
      piscofins = { cst, tpRetPisCofins: ret };
    }
    let retencoes: NonNullable<NfseFiscalProfile['tribFed']>['retencoes'] = null;
    if (fedRaw.retencoes !== null && fedRaw.retencoes !== undefined) {
      const rt = object(fedRaw.retencoes, 'tribFed.retencoes', ['cpPct', 'irrfPct', 'csllPct']);
      const pct = (value: unknown, field: string): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const normalized = normalizePercent(value);
        if (normalized === null) {
          errors.push(`tribFed.retencoes.${field} invalido (0 a 100, ate 2 casas)`);
        }
        return normalized;
      };
      retencoes = {
        cpPct: pct(rt.cpPct, 'cpPct'),
        irrfPct: pct(rt.irrfPct, 'irrfPct'),
        csllPct: pct(rt.csllPct, 'csllPct'),
      };
    }
    tribFed = { piscofins, retencoes };
  }

  const totRaw = object(item.totTrib, 'totTrib', ['tipo', 'fed', 'est', 'mun']);
  let totTrib: NfseTotTribProfile = { tipo: 'indicador' };
  if (totRaw.tipo === 'indicador') {
    for (const key of ['fed', 'est', 'mun']) {
      if (totRaw[key] !== undefined) {
        errors.push(`totTrib.${key} nao se aplica a tipo indicador`);
      }
    }
  } else if (totRaw.tipo === 'percentuais' || totRaw.tipo === 'valores') {
    const fed = normalizePercent(totRaw.fed);
    const est = normalizePercent(totRaw.est);
    const mun = normalizePercent(totRaw.mun);
    if (fed === null || est === null || mun === null) {
      errors.push('totTrib: fed, est e mun sao percentuais de 0 a 100 com ate 2 casas');
    } else {
      totTrib = { tipo: totRaw.tipo, fed, est, mun };
    }
  } else {
    errors.push("totTrib.tipo deve ser 'indicador', 'percentuais' ou 'valores'");
  }

  const ibsRaw = object(item.ibscbs, 'ibscbs', [
    'indDest',
    'cIndOp',
    'indFinal',
    'tpOper',
    'tpEnteGov',
    'cst',
    'cClassTrib',
  ]);
  const indDest = only<0 | 1>(ibsRaw.indDest, [0, 1], 'ibscbs.indDest');
  const cIndOp = digits(ibsRaw.cIndOp, 'ibscbs.cIndOp', 6);
  const indFinal =
    ibsRaw.indFinal === null || ibsRaw.indFinal === undefined
      ? null
      : only<0 | 1>(ibsRaw.indFinal, [0, 1], 'ibscbs.indFinal');
  const tpOper =
    ibsRaw.tpOper === null || ibsRaw.tpOper === undefined
      ? null
      : only<1 | 2 | 3 | 4 | 5>(ibsRaw.tpOper, [1, 2, 3, 4, 5], 'ibscbs.tpOper');
  const tpEnteGov =
    ibsRaw.tpEnteGov === null || ibsRaw.tpEnteGov === undefined
      ? null
      : only<1 | 2 | 3 | 4>(ibsRaw.tpEnteGov, [1, 2, 3, 4], 'ibscbs.tpEnteGov');
  const cst = digits(ibsRaw.cst, 'ibscbs.cst', 3);
  const cClassTrib = digits(ibsRaw.cClassTrib, 'ibscbs.cClassTrib', 6);

  const apRaw = object(item.aprovacao, 'aprovacao', [
    'status',
    'aprovadoPor',
    'aprovadoEm',
    'conteudoSha256',
  ]);
  const status = (['rascunho', 'aprovado', 'revogado'] as const).find((s) => s === apRaw.status);
  if (status === undefined) {
    errors.push("aprovacao.status deve ser 'rascunho', 'aprovado' ou 'revogado'");
  }
  const optionalText = (value: unknown, field: string, max: number): string | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return text(value, field, max) || null;
  };
  const aprovadoPor = optionalText(apRaw.aprovadoPor, 'aprovacao.aprovadoPor', 120);
  const aprovadoEm = optionalText(apRaw.aprovadoEm, 'aprovacao.aprovadoEm', 10);
  if (aprovadoEm !== null && !isRealDate(aprovadoEm)) {
    errors.push('aprovacao.aprovadoEm: use AAAA-MM-DD');
  }
  const conteudoSha256 = optionalText(apRaw.conteudoSha256, 'aprovacao.conteudoSha256', 64);
  if (conteudoSha256 !== null && !/^[0-9a-f]{64}$/.test(conteudoSha256)) {
    errors.push('aprovacao.conteudoSha256 invalido');
  }

  if (
    errors.length > 0 ||
    status === undefined ||
    indDest === null ||
    typeof tomadorRaw.exigeEndereco !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    versao,
    descricao,
    servico: { cTribNac, cTribMun, cNBS },
    permitidos: { tribIssqn, tpRetIssqn },
    tomador: { exigeEndereco: tomadorRaw.exigeEndereco },
    tribFed,
    totTrib,
    ibscbs: { indDest, cIndOp, indFinal, tpOper, tpEnteGov, cst, cClassTrib },
    aprovacao: { status, aprovadoPor, aprovadoEm, conteudoSha256 },
  };
}

// ---------------------------------------------------------------------------------------------------
// Aprovacao e selecao
// ---------------------------------------------------------------------------------------------------

export type ProfileCheck =
  { readonly usable: true } | { readonly usable: false; readonly motivo: string };

/**
 * O perfil pode ser usado numa emissao? So se estiver APROVADO, por alguem identificado, numa data valida e
 * nao futura, e com o hash do conteudo IGUAL ao aprovado (nenhuma alteracao depois da aprovacao).
 */
export function checkProfile(profile: NfseFiscalProfile, today: string): ProfileCheck {
  const approval = profile.aprovacao;
  if (approval.status === 'revogado') {
    return { usable: false, motivo: 'perfil revogado' };
  }
  if (approval.status !== 'aprovado') {
    return { usable: false, motivo: 'perfil ainda nao aprovado pela contadora' };
  }
  if (
    approval.aprovadoPor === null ||
    approval.aprovadoEm === null ||
    approval.conteudoSha256 === null
  ) {
    return {
      usable: false,
      motivo: 'aprovacao incompleta (aprovador, data e hash sao obrigatorios)',
    };
  }
  if (approval.aprovadoEm > today) {
    return { usable: false, motivo: 'data de aprovacao no futuro' };
  }
  if (approval.conteudoSha256 !== profileContentHash(profile)) {
    return { usable: false, motivo: 'conteudo alterado depois da aprovacao (hash nao confere)' };
  }
  return { usable: true };
}

export type ProfileSelection =
  | { readonly ok: true; readonly profile: NfseFiscalProfile }
  | { readonly ok: false; readonly error: string };

/**
 * Perfil do servico `cTribNac`: de cada `id` vale a MAIOR versao; se mais de um `id` atende o mesmo servico,
 * e ambiguo (recusa); sem perfil, ou com perfil nao aprovado/alterado, tambem recusa. Fail-closed.
 */
export function selectProfile(
  perfis: readonly NfseFiscalProfile[],
  cTribNac: string,
  today: string,
): ProfileSelection {
  const latest = new Map<string, NfseFiscalProfile>();
  for (const profile of perfis) {
    const current = latest.get(profile.id);
    if (current === undefined || profile.versao > current.versao) {
      latest.set(profile.id, profile);
    }
  }
  const candidates = [...latest.values()].filter(
    (profile) => profile.servico.cTribNac === cTribNac,
  );
  if (candidates.length === 0) {
    return { ok: false, error: 'servico: nao ha perfil fiscal cadastrado para este codigo' };
  }
  const [profile] = candidates;
  if (candidates.length > 1 || profile === undefined) {
    return { ok: false, error: 'servico: mais de um perfil fiscal para este codigo (ambiguo)' };
  }
  const check = checkProfile(profile, today);
  if (!check.usable) {
    return {
      ok: false,
      error: `servico: perfil fiscal ${profile.id} v${String(profile.versao)}: ${check.motivo}`,
    };
  }
  return { ok: true, profile };
}

// ---------------------------------------------------------------------------------------------------
// Instantaneo para uma emissao
// ---------------------------------------------------------------------------------------------------

const toCents = (decimal: string): bigint => BigInt(decimal.replace('.', ''));

/** `cents` -> `N.NN` (texto decimal exato; o esquema aceita `0.NN` e inteiros sem zero a esquerda). */
function formatCents(cents: bigint): string {
  const whole = cents / 100n;
  const rest = (cents % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${rest}`;
}

/** `valor` (R$, 2 casas) x `pct` (%, 2 casas), arredondado meio para cima, sem `number`. */
export function applyPercent(valor: string, pct: string): string {
  const product = toCents(valor) * toCents(pct);
  return formatCents((product + 5000n) / 10000n);
}

export type SnapshotResult =
  | { readonly ok: true; readonly snapshot: NfseFiscalSnapshot }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Resolve o perfil para UMA emissao: confere o que o pedido pode usar (`iss`, `ret`) e calcula os valores
 * que dependem do valor do servico (retencoes federais e total de tributos), com aritmetica decimal exata.
 * Quem chama garante que o perfil passou por `selectProfile` (aprovado e integro).
 */
export function buildFiscalSnapshot(
  profile: NfseFiscalProfile,
  emission: { readonly valor: string; readonly tribIssqn: 1 | 4; readonly tpRetIssqn: 1 | 2 | 3 },
): SnapshotResult {
  const errors: string[] = [];
  if (!profile.permitidos.tribIssqn.includes(emission.tribIssqn)) {
    errors.push('iss: valor nao permitido pelo perfil fiscal');
  }
  if (!profile.permitidos.tpRetIssqn.includes(emission.tpRetIssqn)) {
    errors.push('ret: valor nao permitido pelo perfil fiscal');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const fed = profile.tribFed;
  const retencoes = fed?.retencoes ?? null;
  const tribFed =
    fed === null
      ? null
      : {
          piscofins: fed.piscofins,
          vRetCP: retencoes?.cpPct == null ? null : applyPercent(emission.valor, retencoes.cpPct),
          vRetIRRF:
            retencoes?.irrfPct == null ? null : applyPercent(emission.valor, retencoes.irrfPct),
          vRetCSLL:
            retencoes?.csllPct == null ? null : applyPercent(emission.valor, retencoes.csllPct),
        };
  const totTrib: NfseTotTribProfile =
    profile.totTrib.tipo === 'valores'
      ? {
          tipo: 'valores',
          fed: applyPercent(emission.valor, profile.totTrib.fed),
          est: applyPercent(emission.valor, profile.totTrib.est),
          mun: applyPercent(emission.valor, profile.totTrib.mun),
        }
      : profile.totTrib;

  return {
    ok: true,
    snapshot: {
      perfil: {
        id: profile.id,
        versao: profile.versao,
        conteudoSha256: profile.aprovacao.conteudoSha256 ?? '',
        aprovadoPor: profile.aprovacao.aprovadoPor ?? '',
        aprovadoEm: profile.aprovacao.aprovadoEm ?? '',
      },
      cTribMun: profile.servico.cTribMun,
      cNBS: profile.servico.cNBS,
      exigeEnderecoTomador: profile.tomador.exigeEndereco,
      tribFed,
      totTrib,
      ibscbs: profile.ibscbs,
    },
  };
}
