/**
 * Leiautes XML/XSD da NFS-e Nacional, por ambiente.
 *
 * Produção e produção restrita publicam pacotes XSD DIFERENTES que declaram a MESMA versão (`1.01`):
 * o atributo `versao` do documento NÃO distingue um do outro. Por isso o leiaute é uma seleção
 * EXPLÍCITA, com identificador próprio (`NfseLayoutId`), e nunca deduzida do XML.
 *
 * Quem escolhe o leiaute é só o AMBIENTE configurado (`layoutForAmbiente`), por uma tabela fixa e
 * congelada: não há variável de ambiente, argumento padrão nem "último pacote" que a mude. Assim a
 * produção continua no leiaute de produção e a restrita no dela, sem possibilidade de troca acidental.
 *
 * Diferenças conhecidas entre os dois pacotes: `docs/nfse-leiautes.md`. Os arquivos oficiais ficam
 * intactos em `xsd/<dir>/` (hashes em `xsd/MANIFEST.json`).
 */

export type NfseLayoutId = 'producao-2026-02' | 'restrita-2026-10';

export interface NfseLayout {
  readonly id: NfseLayoutId;
  readonly ambiente: 'producao' | 'restrita';
  /** Valor do atributo `versao` dos documentos. IGUAL nos dois pacotes: não use para escolher o pacote. */
  readonly versaoDocumento: '1.01';
  /** Pasta do pacote, dentro de `xsd/`. */
  readonly pasta: string;
  /** Data de publicação do pacote oficial (ISO). */
  readonly publicadoEm: string;
  /** Página oficial de onde o pacote foi obtido. */
  readonly fonte: string;
}

export const NFSE_LAYOUTS: Readonly<Record<NfseLayoutId, NfseLayout>> = Object.freeze({
  'producao-2026-02': Object.freeze({
    id: 'producao-2026-02',
    ambiente: 'producao',
    versaoDocumento: '1.01',
    pasta: 'producao-2026-02-09',
    publicadoEm: '2026-02-09',
    fonte:
      'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual (NFSe-ESQUEMAS_XSD-v1.01-20260209)',
  }),
  'restrita-2026-10': Object.freeze({
    id: 'restrita-2026-10',
    ambiente: 'restrita',
    versaoDocumento: '1.01',
    pasta: 'restrita-2026-10-20',
    publicadoEm: '2026-10-20',
    fonte:
      'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita (esquemas_prod_restrita_20261020)',
  }),
});

/** Tabela FIXA ambiente -> leiaute. Única fonte da escolha; congelada. */
export const NFSE_LAYOUT_BY_AMBIENTE: Readonly<Record<'producao' | 'restrita', NfseLayoutId>> =
  Object.freeze({
    producao: 'producao-2026-02',
    restrita: 'restrita-2026-10',
  });

export function layoutForAmbiente(ambiente: 'producao' | 'restrita'): NfseLayout {
  return NFSE_LAYOUTS[NFSE_LAYOUT_BY_AMBIENTE[ambiente]];
}

/** Recusa identificador desconhecido (valor vindo de fora do tipo, por exemplo). */
export function getLayout(id: string): NfseLayout {
  if (!Object.prototype.hasOwnProperty.call(NFSE_LAYOUTS, id)) {
    throw new Error('Leiaute da NFS-e desconhecido');
  }
  return NFSE_LAYOUTS[id as NfseLayoutId];
}
