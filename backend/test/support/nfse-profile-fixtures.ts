/**
 * Perfis fiscais SINTETICOS para testes. Nenhum codigo, aliquota ou valor aqui vem de nota real nem de
 * orientacao da contadora: sao numeros arbitrarios que so precisam respeitar o FORMATO do esquema XSD
 * (6 digitos, 9 digitos, 3 digitos...). Nunca usar como configuracao.
 */
import type { NfseTomadorEndereco } from '../../src/modules/integrations/nfse/nfse-dps';
import {
  profileContentHash,
  type NfseFiscalProfile,
} from '../../src/modules/integrations/nfse/nfse-fiscal-profile';

export const SYNTHETIC_SERVICE = '990101';
export const SYNTHETIC_TODAY = '2026-10-15';

type Draft = Omit<NfseFiscalProfile, 'aprovacao'>;

export function syntheticDraft(over: Partial<Draft> = {}): Draft {
  return {
    id: 'servico-sintetico',
    versao: 1,
    descricao: 'Perfil sintetico de teste (sem valor fiscal)',
    servico: { cTribNac: SYNTHETIC_SERVICE, cTribMun: '777', cNBS: '188888888' },
    permitidos: { tribIssqn: [1], tpRetIssqn: [1, 2] },
    tomador: { exigeEndereco: true },
    tribFed: {
      piscofins: { cst: '99', tpRetPisCofins: '9' },
      retencoes: { cpPct: null, irrfPct: '1.50', csllPct: '2.00' },
    },
    totTrib: { tipo: 'valores', fed: '10.00', est: '5.00', mun: '2.50' },
    ibscbs: {
      indDest: 0,
      cIndOp: '288888',
      indFinal: 0,
      tpOper: null,
      tpEnteGov: null,
      cst: '288',
      cClassTrib: '288888',
    },
    ...over,
  };
}

/** Perfil aprovado, com o hash do conteudo correto. */
export function approvedProfile(over: Partial<Draft> = {}): NfseFiscalProfile {
  const draft = syntheticDraft(over);
  return {
    ...draft,
    aprovacao: {
      status: 'aprovado',
      aprovadoPor: 'Contadora Ficticia',
      aprovadoEm: '2026-10-01',
      conteudoSha256: profileContentHash(draft),
    },
  };
}

/** Endereco SINTETICO do tomador (logradouro e CEP inventados). */
export const SYNTHETIC_ADDRESS: NfseTomadorEndereco = {
  cMun: '3106200',
  cep: '30000000',
  logradouro: 'Rua Ficticia',
  numero: '100',
  complemento: null,
  bairro: 'Bairro Ficticio',
};
