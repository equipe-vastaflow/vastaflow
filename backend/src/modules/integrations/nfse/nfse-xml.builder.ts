import type { NfseEmissionInput, NfseTomadorEndereco } from './nfse-dps';
import type { NfseFiscalSnapshot } from './nfse-fiscal-profile';
import type { NfseLayoutId } from './nfse-layout';
import type { NfseSettings } from './nfse-settings';

/** Namespace e versao do leiaute DPS. Os dois pacotes versionados declaram `1.01` (ver `nfse-layout.ts`). */
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

const isRestrita = (layout: NfseLayoutId): boolean => layout === 'restrita-2026-10';

/** `toma/end`: endereco nacional (`endNac`) e depois logradouro, numero, complemento e bairro. */
function buildEndereco(endereco: NfseTomadorEndereco): string {
  return (
    '<end>' +
    `<endNac>${el('cMun', endereco.cMun)}${el('CEP', endereco.cep)}</endNac>` +
    el('xLgr', endereco.logradouro) +
    el('nro', endereco.numero) +
    (endereco.complemento === null ? '' : el('xCpl', endereco.complemento)) +
    el('xBairro', endereco.bairro) +
    '</end>'
  );
}

/**
 * `cServ`. A ORDEM muda entre os leiautes (esquemas oficiais):
 * - producao (`producao-2026-02`):  cTribNac, cTribMun, xDescServ, cNBS;
 * - restrita (`restrita-2026-10`):  cTribNac, cTribMun, cNBS, xDescServ.
 */
function buildCServ(
  input: NfseEmissionInput,
  fiscal: NfseFiscalSnapshot | null,
  layout: NfseLayoutId,
): string {
  const cTribMun = fiscal?.cTribMun == null ? '' : el('cTribMun', fiscal.cTribMun);
  const cNBS = fiscal === null ? '' : el('cNBS', fiscal.cNBS);
  const descricao = el('xDescServ', input.descricao);
  return `<cServ>${el('cTribNac', input.servico)}${cTribMun}${
    isRestrita(layout) ? cNBS + descricao : descricao + cNBS
  }</cServ>`;
}

/** `tribFed`: retencoes federais do perfil (PIS/COFINS, CP, IRRF, CSLL). Vazio se nao ha nada a informar. */
function buildTribFed(fiscal: NfseFiscalSnapshot | null): string {
  const fed = fiscal?.tribFed;
  if (fed === null || fed === undefined) {
    return '';
  }
  const piscofins =
    fed.piscofins === null
      ? ''
      : '<piscofins>' +
        el('CST', fed.piscofins.cst) +
        (fed.piscofins.tpRetPisCofins === null
          ? ''
          : el('tpRetPisCofins', fed.piscofins.tpRetPisCofins)) +
        '</piscofins>';
  const inner =
    piscofins +
    (fed.vRetCP === null ? '' : el('vRetCP', fed.vRetCP)) +
    (fed.vRetIRRF === null ? '' : el('vRetIRRF', fed.vRetIRRF)) +
    (fed.vRetCSLL === null ? '' : el('vRetCSLL', fed.vRetCSLL));
  return inner === '' ? '' : `<tribFed>${inner}</tribFed>`;
}

/** `totTrib`: ME/EPP informa o percentual do Simples; nao optante, o que o perfil define. */
function buildTotTrib(input: NfseEmissionInput, fiscal: NfseFiscalSnapshot | null): string {
  if (fiscal === null) {
    return input.totTribSimples === null
      ? el('indTotTrib', '0')
      : el('pTotTribSN', input.totTribSimples);
  }
  const tot = fiscal.totTrib;
  switch (tot.tipo) {
    case 'indicador':
      return el('indTotTrib', '0');
    case 'percentuais':
      return `<pTotTrib>${el('pTotTribFed', tot.fed)}${el('pTotTribEst', tot.est)}${el('pTotTribMun', tot.mun)}</pTotTrib>`;
    case 'valores':
      return `<vTotTrib>${el('vTotTribFed', tot.fed)}${el('vTotTribEst', tot.est)}${el('vTotTribMun', tot.mun)}</vTotTrib>`;
  }
}

/**
 * Grupo `IBSCBS` da DPS. Posicao e obrigatoriedade mudam entre os leiautes (esquemas oficiais):
 * - producao: `finNFSe` DENTRO do grupo (obrigatorio) e `cIndOp` obrigatorio; CST e cClassTrib em
 *   `valores/trib/gIBSCBS`;
 * - restrita: `finNFSe` sai do grupo (vai para `infDPS`); CST e cClassTrib sobem para `valores/trib`.
 * Ordem comum: finNFSe (so producao), indFinal, cIndOp, tpOper, tpEnteGov, indDest, valores.
 */
function buildIbsCbs(fiscal: NfseFiscalSnapshot | null, layout: NfseLayoutId): string {
  if (fiscal === null) {
    return '';
  }
  const ib = fiscal.ibscbs;
  const sit = el('CST', ib.cst) + el('cClassTrib', ib.cClassTrib);
  const trib = isRestrita(layout)
    ? `<trib>${sit}</trib>`
    : `<trib><gIBSCBS>${sit}</gIBSCBS></trib>`;
  return (
    '<IBSCBS>' +
    (isRestrita(layout) ? '' : el('finNFSe', '0')) +
    (ib.indFinal === null ? '' : el('indFinal', String(ib.indFinal))) +
    el('cIndOp', ib.cIndOp) +
    (ib.tpOper === null ? '' : el('tpOper', String(ib.tpOper))) +
    (ib.tpEnteGov === null ? '' : el('tpEnteGov', String(ib.tpEnteGov))) +
    el('indDest', String(ib.indDest)) +
    `<valores>${trib}</valores>` +
    '</IBSCBS>'
  );
}

/**
 * Gera a DPS no leiaute oficial do LEIAUTE informado (`producao-2026-02` ou `restrita-2026-10`). Ordem dos
 * elementos = `xs:sequence` do esquema de cada leiaute.
 *
 * Nada e calculado nem presumido aqui: so o que a pessoa informou, o que a empresa configurou e, para
 * empresa NAO optante, o que o PERFIL FISCAL aprovado define (`input.fiscal`, resolvido no pedido). Sem
 * `fiscal` o resultado e o do ME/EPP, sem IBS/CBS, exceto o `finNFSe` que a restrita exige em `infDPS`.
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
  layout: NfseLayoutId,
): BuiltDps {
  const dpsId = buildDpsId(
    settings.municipioEmissor,
    settings.prestadorCnpj,
    settings.serie,
    numero,
  );
  const fiscal = input.fiscal ?? null;

  const prestador =
    el('CNPJ', settings.prestadorCnpj) +
    (settings.prestadorIm === null ? '' : el('IM', settings.prestadorIm)) +
    (settings.prestadorNome === null ? '' : el('xNome', settings.prestadorNome)) +
    '<regTrib>' +
    el('opSimpNac', String(settings.opSimpNac)) +
    (settings.regApTribSN === null ? '' : el('regApTribSN', String(settings.regApTribSN))) +
    el('regEspTrib', String(settings.regEspTrib)) +
    '</regTrib>';

  const tomador =
    el(input.tomadorTipo, input.tomadorDoc) +
    el('xNome', input.tomadorNome) +
    (input.tomadorEndereco == null ? '' : buildEndereco(input.tomadorEndereco));

  const servico =
    '<locPrest>' +
    el('cLocPrestacao', input.localPrestacao) +
    '</locPrest>' +
    buildCServ(input, fiscal, layout);

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
    buildTribFed(fiscal) +
    '<totTrib>' +
    buildTotTrib(input, fiscal) +
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
    // Restrita: `finNFSe` (0 = NFS-e regular) e obrigatorio em TODA DPS, direto em `infDPS`.
    (isRestrita(layout) ? el('finNFSe', '0') : '') +
    el('cLocEmi', settings.municipioEmissor) +
    `<prest>${prestador}</prest>` +
    `<toma>${tomador}</toma>` +
    `<serv>${servico}</serv>` +
    `<valores>${valores}</valores>` +
    buildIbsCbs(fiscal, layout) +
    '</infDPS>' +
    '</DPS>';

  return { dpsId, xml };
}
