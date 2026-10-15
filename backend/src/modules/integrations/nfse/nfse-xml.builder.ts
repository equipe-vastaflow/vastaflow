import type { NfseEmissionInput } from './nfse-dps';
import type { NfseSettings } from './nfse-settings';

/** Namespace e versao do leiaute DPS (esquemas oficiais v1.01, 09/02/2026). */
export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
export const NFSE_LAYOUT_VERSION = '1.01';
/** `verAplic`: 1 a 20 caracteres. */
export const NFSE_APP_VERSION = 'VastaFlow-1';

/** `Id` da DPS: "DPS" + municipio (7) + tipo de inscricao (1: CPF, 2: CNPJ) + inscricao (14) + serie (5) + numero (15). */
export function buildDpsId(
  municipioEmissor: string,
  cnpj: string,
  serie: string,
  numero: number,
): string {
  return `DPS${municipioEmissor}2${cnpj.padStart(14, '0')}${serie.padStart(5, '0')}${String(numero).padStart(15, '0')}`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const el = (name: string, value: string): string => `<${name}>${escapeXml(value)}</${name}>`;

/** `AAAA-MM-DDThh:mm:ss-03:00` (Brasilia, sem horario de verao desde 2019). */
export function formatDhEmi(now: Date): string {
  return `${new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
}

export interface BuiltDps {
  readonly dpsId: string;
  /** XML SEM assinatura, UTF-8, sem prefixo de namespace, em uma linha. */
  readonly xml: string;
}

/**
 * Gera a DPS no leiaute oficial v1.01. Ordem dos elementos = `xs:sequence` dos esquemas.
 *
 * Nada e calculado nem presumido: so o que a pessoa informou e o que a empresa configurou. O grupo
 * IBS/CBS NAO e gerado (opcional so para optantes do Simples; ver `resolveNfseSettings`).
 */
export function buildDpsXml(
  input: NfseEmissionInput,
  settings: Pick<
    NfseSettings,
    | 'tpAmb'
    | 'municipioEmissor'
    | 'prestadorCnpj'
    | 'prestadorIm'
    | 'prestadorNome'
    | 'opSimpNac'
    | 'regApTribSN'
    | 'regEspTrib'
    | 'serie'
  >,
  numero: number,
  now: Date,
): BuiltDps {
  const dpsId = buildDpsId(
    settings.municipioEmissor,
    settings.prestadorCnpj,
    settings.serie,
    numero,
  );

  const prestador =
    el('CNPJ', settings.prestadorCnpj) +
    (settings.prestadorIm === null ? '' : el('IM', settings.prestadorIm)) +
    (settings.prestadorNome === null ? '' : el('xNome', settings.prestadorNome)) +
    '<regTrib>' +
    el('opSimpNac', String(settings.opSimpNac)) +
    (settings.regApTribSN === null ? '' : el('regApTribSN', String(settings.regApTribSN))) +
    el('regEspTrib', String(settings.regEspTrib)) +
    '</regTrib>';

  const tomador = el(input.tomadorTipo, input.tomadorDoc) + el('xNome', input.tomadorNome);

  const servico =
    '<locPrest>' +
    el('cLocPrestacao', input.localPrestacao) +
    '</locPrest>' +
    '<cServ>' +
    el('cTribNac', input.servico) +
    el('xDescServ', input.descricao) +
    '</cServ>';

  const totTrib =
    input.totTribSimples === null ? el('indTotTrib', '0') : el('pTotTribSN', input.totTribSimples);

  const valores =
    '<vServPrest>' +
    el('vServ', input.valor) +
    '</vServPrest>' +
    '<trib>' +
    '<tribMun>' +
    el('tribISSQN', String(input.tribIssqn)) +
    el('tpRetISSQN', String(input.tpRetIssqn)) +
    (input.aliquota === null ? '' : el('pAliq', input.aliquota)) +
    '</tribMun>' +
    '<totTrib>' +
    totTrib +
    '</totTrib>' +
    '</trib>';

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<DPS xmlns="${NFSE_NAMESPACE}" versao="${NFSE_LAYOUT_VERSION}">` +
    `<infDPS Id="${dpsId}">` +
    el('tpAmb', String(settings.tpAmb)) +
    el('dhEmi', formatDhEmi(now)) +
    el('verAplic', NFSE_APP_VERSION) +
    el('serie', String(Number(settings.serie))) +
    el('nDPS', String(numero)) +
    el('dCompet', input.competencia) +
    el('tpEmit', '1') +
    el('cLocEmi', settings.municipioEmissor) +
    `<prest>${prestador}</prest>` +
    `<toma>${tomador}</toma>` +
    `<serv>${servico}</serv>` +
    `<valores>${valores}</valores>` +
    '</infDPS>' +
    '</DPS>';

  return { dpsId, xml };
}
