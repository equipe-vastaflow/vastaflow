import type { NfseFiscalProfile } from './nfse-fiscal-profile';
import { ANEXO_B_NBS } from './tabelas/anexo-b-nbs';
import { ANEXO_B_SERVICOS } from './tabelas/anexo-b-servicos';
import { ANEXO_C_INDOP, type ClasseIndOp } from './tabelas/anexo-c-indop';

/**
 * COMPATIBILIDADE entre um perfil fiscal e o que o VastaFlow consegue gerar: um perfil so pode ser usado se existe
 * uma DPS VALIDA para ele. As regras abaixo vem do Anexo I (SEFIN ADN DPS NFS-e, v1.01 de 20/10/2026, producao
 * restrita) e das tabelas oficiais (Anexos B e C), todas com a fonte indicada. NADA aqui foi inventado: o que nao se
 * prova pelos anexos fica como PENDENCIA em `docs/nfse-perfis-fiscais.md` e NAO e verificado.
 *
 * Duas familias:
 * - TABELA: o codigo existe na tabela oficial;
 * - GERADOR: a regra do leiaute exige um grupo/campo que o VastaFlow ainda NAO gera (dest, gRefNFSe, imovel,
 *   prest/end, endExt, atvEvento) ou combina campos de forma que a Sefin recusa. Perfil que dependa disso e
 *   recusado de forma explicita, em vez de gerar uma DPS que a Sefin rejeitaria.
 *
 * Mensagens citam o NOME do campo e a regra, nunca o valor.
 */
export interface CompatIssue {
  /** Identificador estavel da regra (documentado em `docs/nfse-perfis-fiscais.md`). */
  readonly regra: string;
  readonly campo: string;
  readonly mensagem: string;
}

type Subject = Pick<NfseFiscalProfile, 'servico' | 'permitidos' | 'tomador' | 'tribFed' | 'ibscbs'>;

/**
 * Subitens de construcao civil (Anexo I): para eles o grupo `imovel` NAO e permitido. cTribNac = subitem(4) + desdobro(2).
 * Texto do anexo: 07.02.01, 07.02.02, 07.04.01, 07.05.01, 07.05.02, 07.06.01, 07.06.02, 07.07.01, 07.08.01, 07.17.01, 07.19.01.
 */
const CONSTRUCAO_CIVIL = new Set([
  '070201',
  '070202',
  '070401',
  '070501',
  '070502',
  '070601',
  '070602',
  '070701',
  '070801',
  '071701',
  '071901',
]);

/** Subitens da LC 116 para os quais `tpOper` e obrigatorio (Anexo I): 25.05, 15.09, 17.12 e 10.05 (so o prefixo do `cTribNac`). */
const TPOPER_SUBITENS = ['2505', '1509', '1712', '1005'];

const CLASSES_NAO_GERADAS: Partial<Record<ClasseIndOp, string>> = {
  'estabelecimento-prestador':
    'identifica o local pelo endereco do prestador (prest/end), que o VastaFlow nao gera',
  destinatario: 'identifica o local pelo grupo dest (destinatario), que o VastaFlow nao gera',
  exterior: 'depende de endereco no exterior (endExt), que o VastaFlow nao gera',
  evento: 'depende do grupo atvEvento (evento), que o VastaFlow nao gera',
  via: 'e exclusivo da NFS-e Via',
};

const RETIDOS_CSLL = new Set(['1', '3', '4', '5', '6', '7', '8', '9']);

export function checkProfileCompatibility(profile: Subject): CompatIssue[] {
  const issues: CompatIssue[] = [];
  const add = (regra: string, campo: string, mensagem: string): void => {
    issues.push({ regra, campo, mensagem });
  };
  const { cTribNac, cNBS } = profile.servico;
  const { cIndOp, indDest, tpOper, tpEnteGov } = profile.ibscbs;

  // ---- Tabelas oficiais ------------------------------------------------------------------------------
  if (!ANEXO_B_SERVICOS.has(cTribNac)) {
    add(
      'TAB-1',
      'servico.cTribNac',
      'servico.cTribNac: codigo inexistente na lista de servico nacional (Anexo B)',
    );
  }
  if (!ANEXO_B_NBS.has(cNBS)) {
    add('TAB-2', 'servico.cNBS', 'servico.cNBS: codigo inexistente na tabela NBS 2.0 (Anexo B)');
  }
  const indOp = ANEXO_C_INDOP[cIndOp];
  if (indOp === undefined) {
    add(
      'TAB-3',
      'ibscbs.cIndOp',
      'ibscbs.cIndOp: codigo inexistente na tabela de indicador de operacao (Anexo C)',
    );
  }

  // ---- Servico ---------------------------------------------------------------------------------------
  // "Se o cTribNac for 99.03.xx ou 99.04.01, a NFS-e deve ser rejeitada" (novos fatos geradores de IBS/CBS).
  if (cTribNac.startsWith('9903') || cTribNac === '990401') {
    add(
      'SRV-1',
      'servico.cTribNac',
      'servico.cTribNac: 99.03.xx e 99.04.01 (locacao/cessao de bens) sao recusados pelo sistema com IBS/CBS e exigem grupos que o VastaFlow nao gera',
    );
  }

  // ---- Indicador de operacao (Anexo C) ---------------------------------------------------------------
  if (indOp !== undefined) {
    const naoGerada = CLASSES_NAO_GERADAS[indOp.classe];
    if (naoGerada !== undefined) {
      add('OP-1', 'ibscbs.cIndOp', `ibscbs.cIndOp: este indicador de operacao ${naoGerada}`);
    }
    // "cIndOp relativo a imovel => o grupo imovel e obrigatorio", exceto nos subitens de construcao civil (nos
    // quais o grupo imovel NAO e permitido).
    if (indOp.classe === 'imovel' && !CONSTRUCAO_CIVIL.has(cTribNac)) {
      add(
        'OP-2',
        'ibscbs.cIndOp',
        'ibscbs.cIndOp: operacao com imovel exige o grupo imovel, que o VastaFlow nao gera',
      );
    }
    // "Se o indicador de operacao identifica o local pelo endereco do adquirente e o destinatario e o proprio
    // adquirente (indDest=0), o endereco nacional do tomador e obrigatorio."
    if (
      indOp.classe === 'adquirente-ou-destinatario' &&
      indDest === 0 &&
      !profile.tomador.exigeEndereco
    ) {
      add(
        'END-1',
        'tomador.exigeEndereco',
        'tomador.exigeEndereco: com este cIndOp e indDest=0 o local de incidencia e o endereco do tomador; o endereco e obrigatorio (deve ser verdadeiro)',
      );
    }
  }

  // ---- Destinatario ----------------------------------------------------------------------------------
  // "E obrigatorio identificar o destinatario quando indDest = 1."
  if (indDest === 1) {
    add(
      'DEST-1',
      'ibscbs.indDest',
      'ibscbs.indDest=1: exige o grupo dest (destinatario), que o VastaFlow ainda nao gera',
    );
  }

  // ---- tpOper / tpEnteGov ----------------------------------------------------------------------------
  // "O grupo de documentos referenciados (gRefNFSe) deve ser informado quando tpOper = 2 ou 3."
  if (tpOper === 2 || tpOper === 3) {
    add(
      'REF-1',
      'ibscbs.tpOper',
      'ibscbs.tpOper=2 ou 3: exige o grupo gRefNFSe (NFS-e referenciada), que o VastaFlow ainda nao gera',
    );
  }
  // "tpOper deve ser informado se tpEnteGov for informado ou se o servico corresponder aos subitens 25.05, 15.09,
  // 17.12 ou 10.05; nao pode ser informado nos demais casos."
  const exigeTpOper =
    tpEnteGov !== null || TPOPER_SUBITENS.some((prefixo) => cTribNac.startsWith(prefixo));
  if (exigeTpOper && tpOper === null) {
    add(
      'OPER-1',
      'ibscbs.tpOper',
      'ibscbs.tpOper: obrigatorio quando tpEnteGov esta informado ou o servico e 25.05, 15.09, 17.12 ou 10.05',
    );
  }
  if (!exigeTpOper && tpOper !== null) {
    add(
      'OPER-2',
      'ibscbs.tpOper',
      'ibscbs.tpOper: so pode ser informado em compra governamental (tpEnteGov) ou nos servicos 25.05, 15.09, 17.12 e 10.05',
    );
  }

  // ---- Retencao do ISSQN -----------------------------------------------------------------------------
  // "O tomador deve ser identificado e seu endereco nacional informado se houver retencao do ISSQN (tpRetISSQN = 2)."
  if (profile.permitidos.tpRetIssqn.includes(2) && !profile.tomador.exigeEndereco) {
    add(
      'END-2',
      'tomador.exigeEndereco',
      'tomador.exigeEndereco: com retencao do ISS pelo tomador (permitidos.tpRetIssqn inclui 2) o endereco nacional do tomador e obrigatorio',
    );
  }

  // ---- PIS/COFINS/CSLL -------------------------------------------------------------------------------
  // tpRetPisCofins = 0 => vRetCSLL nao permitido; diferente de 0 e de 2 => vRetCSLL obrigatorio.
  const tpRet = profile.tribFed?.piscofins?.tpRetPisCofins ?? null;
  const csll = profile.tribFed?.retencoes?.csllPct ?? null;
  if (tpRet !== null && RETIDOS_CSLL.has(tpRet) && csll === null) {
    add(
      'PC-1',
      'tribFed.retencoes.csllPct',
      'tribFed.retencoes.csllPct: com tpRetPisCofins diferente de 0 e de 2 a retencao (vRetCSLL) e obrigatoria',
    );
  }
  if (tpRet === '0' && csll !== null) {
    add(
      'PC-2',
      'tribFed.retencoes.csllPct',
      'tribFed.retencoes.csllPct: com tpRetPisCofins=0 (nao retidos) a retencao (vRetCSLL) nao e permitida',
    );
  }

  return issues;
}

/** Texto curto para quem nao pode usar o perfil (sem valores; no maximo 3 regras, o resto vira contagem). */
export function describeIssues(issues: readonly CompatIssue[]): string {
  const shown = issues
    .slice(0, 3)
    .map((issue) => `${issue.regra}: ${issue.mensagem}`)
    .join('; ');
  return issues.length > 3 ? `${shown}; (+${String(issues.length - 3)})` : shown;
}
