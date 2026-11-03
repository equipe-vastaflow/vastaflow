/**
 * ANEXO C - Codigo indicador da operacao (cIndOp, 6 digitos) e ONDE o local do fornecimento e identificado na DPS.
 *
 * DADOS OFICIAIS (tabelas publicadas pelo Sistema Nacional NFS-e), copiados sem inventar nada. Nao edite a mao.
 * Fonte: gov.br/nfse > Documentacao Tecnica > Producao restrita: ANEXO_C-INDOP_IBSCBS (v1.01, 22/01/2026), coluna "Campo no leiaute da NFSe".
 * SHA-256 do .xlsx de producao restrita: f13b08dc802e82c3c43d591d06575922095595a17c94e61bc4a37c41633a744b
 * A "documentacao atual" traz os MESMOS 26 codigos (sem a coluna de campo do leiaute).
 * `classe` resume essa coluna (derivacao mecanica, conferida em teste):
 *  - local-da-prestacao: o local e o `serv/locPrest/cLocPrestacao` (sempre informado);
 *  - adquirente-ou-destinatario: indDest=0 -> `toma/end` (endereco do tomador); indDest=1 -> `IBSCBS/dest/`;
 *  - destinatario: `IBSCBS/dest/`;
 *  - estabelecimento-prestador: `prest/end/`;
 *  - imovel: `cLocPrestacao` (localidade do imovel) + grupo `imovel`;
 *  - exterior: endereco no exterior (`endExt`) do tomador ou do destinatario;
 *  - evento: grupo `serv/atvEvento/`;
 *  - via: EXCLUSIVO da NFS-e Via.
 */
export type ClasseIndOp =
  | 'local-da-prestacao'
  | 'adquirente-ou-destinatario'
  | 'destinatario'
  | 'estabelecimento-prestador'
  | 'imovel'
  | 'exterior'
  | 'evento'
  | 'via';

export interface IndOpOficial {
  readonly classe: ClasseIndOp;
  /** "Local do fornecimento a ser identificado no DF-e" (texto oficial resumido). */
  readonly local: string;
}

export const ANEXO_C_INDOP: Readonly<Record<string, IndOpOficial>> = {
  '020101': { classe: 'imovel', local: "Localidade do imóvel" },
  '020201': { classe: 'imovel', local: "Localidade do imóvel" },
  '020301': { classe: 'imovel', local: "Localidade do imóvel" },
  '030101': { classe: 'estabelecimento-prestador', local: "Estabelecimento do fornecedor" },
  '030102': { classe: 'adquirente-ou-destinatario', local: "Endereço do adquirente" },
  '030103': { classe: 'destinatario', local: "Endereço do destinatário" },
  '030104': { classe: 'local-da-prestacao', local: "Endereço diverso do fornecedor, adquirente ou destinatário" },
  '040101': { classe: 'evento', local: "Local do Evento" },
  '050101': { classe: 'estabelecimento-prestador', local: "Estabelecimento do fornecedor" },
  '050102': { classe: 'adquirente-ou-destinatario', local: "Endereço do adquirente" },
  '050103': { classe: 'destinatario', local: "Endereço do destinatário" },
  '050104': { classe: 'local-da-prestacao', local: "Endereço diverso do fornecedor, adquirente ou destinatário" },
  '050201': { classe: 'local-da-prestacao', local: "Local da prestação" },
  '060101': { classe: 'local-da-prestacao', local: "Local de início do transporte" },
  '070101': { classe: 'local-da-prestacao', local: "Endereço fornecido para entrega" },
  '070102': { classe: 'local-da-prestacao', local: "Local da retirada" },
  '080101': { classe: 'via', local: "Local da prestação, correspondente à extensão da via explorada e proporcional ao território dos entes tributantes" },
  '100101': { classe: 'adquirente-ou-destinatario', local: "Local do domicílio principal do adquirente" },
  '100102': { classe: 'exterior', local: "Local do domicílio do destinatário, nos casos de adquirente residente ou domiciliado no exterior" },
  '100201': { classe: 'adquirente-ou-destinatario', local: "Local do domicílio principal do destinatário" },
  '100301': { classe: 'adquirente-ou-destinatario', local: "Local do domicílio principal do adquirente" },
  '100302': { classe: 'exterior', local: "Local do domicílio do destinatário, nos casos de adquirente residente ou domiciliado no exterior" },
  '100401': { classe: 'adquirente-ou-destinatario', local: "Local do domicílio principal do destinatário" },
  '100501': { classe: 'adquirente-ou-destinatario', local: "Local do domicílio principal do adquirente" },
  '100502': { classe: 'exterior', local: "Local do domicílio do destinatário, nos casos de adquirente residente ou domiciliado no exterior" },
  '100601': { classe: 'adquirente-ou-destinatario', local: "Local do domicílio principal do destinatário" },
};
