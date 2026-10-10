import { JsonObject, readEnvelope, type Decimal } from './plantae-json';
import { PlantaeApiError } from './plantae-errors';
import type {
  PlantaeAccount,
  PlantaeEntry,
  PlantaeEntryApportionment,
  PlantaeEntryTitle,
  PlantaeIntegration,
  PlantaeInvoiceItem,
  PlantaeInvoiceTotals,
  PlantaeIssuedInvoice,
  PlantaeLegalEntity,
  PlantaeMovement,
  PlantaePerson,
} from './plantae.types';

/**
 * Validacao em RUNTIME das respostas do Plantae.
 *
 * Um `interface` TypeScript nao protege nada contra uma API externa: o tipo some
 * na compilacao. Cada funcao aqui confere a forma real da resposta e devolve o
 * contrato tipado - ou falha com `invalid-response` e o CAMINHO do campo, sem o
 * valor. Nada e "consertado": um campo invalido derruba a resposta inteira em
 * vez de virar um dado plausivel.
 */

/** O que veio de `links`/`meta`, ainda sem interpretacao. */
export interface RawPagination {
  readonly perPage: number | null;
  readonly nextCursor: string | null;
  readonly nextLink: string | null;
  /** `links` estava na resposta. */
  readonly hasLinks: boolean;
  /** `meta` estava na resposta. As duas ausentes = a API nao informou paginacao. */
  readonly hasMeta: boolean;
}

export interface ParsedList<T> {
  readonly items: T[];
  readonly pagination: RawPagination;
  /** O objeto raiz, para quem precisa ler `meta` (extrato). */
  readonly root: JsonObject;
}

function readPagination(root: JsonObject): RawPagination {
  let nextLink: string | null = null;
  let hasLinks = false;
  if (root.has('links')) {
    const links = root.nullableObject('links');
    if (links) {
      hasLinks = true;
      nextLink = links.nullableString('next');
    }
  }
  let perPage: number | null = null;
  let nextCursor: string | null = null;
  let hasMeta = false;
  if (root.has('meta')) {
    const meta = root.nullableObject('meta');
    if (meta) {
      hasMeta = true;
      perPage = meta.has('per_page') ? meta.nullableInt('per_page') : null;
      nextCursor = meta.nullableString('next_cursor');
    }
  }
  return { perPage, nextCursor, nextLink, hasLinks, hasMeta };
}

function parseList<T>(body: unknown, mapItem: (item: JsonObject) => T): ParsedList<T> {
  const root = readEnvelope(body);
  return {
    items: root.objectArray('data').map(mapItem),
    pagination: readPagination(root),
    root,
  };
}

// --- /me --------------------------------------------------------------------

export function parseIntegration(body: unknown): PlantaeIntegration {
  const data = readEnvelope(body).object('data');
  return {
    id: data.int('id'),
    nome: data.string('nome'),
    organizacao_id: data.int('organizacao_id'),
    scopes: data.stringArray('scopes'),
  };
}

// --- pessoas ----------------------------------------------------------------

function mapPerson(obj: JsonObject): PlantaePerson {
  return {
    pessoa_id: obj.int('pessoa_id'),
    nome: obj.nullableString('nome'),
    razao_social: obj.nullableString('razao_social'),
    tipo_pessoa: obj.nullableString('tipo_pessoa'),
    cpf_cnpj: obj.nullableString('cpf_cnpj'),
  };
}

function nullablePerson(parent: JsonObject, key: string): PlantaePerson | null {
  const obj = parent.nullableObject(key);
  return obj ? mapPerson(obj) : null;
}

export function parsePeople(body: unknown): ParsedList<PlantaePerson> {
  return parseList(body, mapPerson);
}

// --- lancamentos ------------------------------------------------------------

function mapTitle(obj: JsonObject): PlantaeEntryTitle {
  const moeda = obj.nullableObject('moeda');
  return {
    titulo_id: obj.int('titulo_id'),
    tipo: obj.nullableNumericCode('tipo'),
    origem: obj.nullableNumericCode('origem'),
    num_documento: obj.nullableString('num_documento'),
    data_emissao: obj.nullableDate('data_emissao'),
    valor_total: obj.nullableDecimal('valor_total'),
    moeda: moeda
      ? {
          moeda_id: moeda.int('moeda_id'),
          nome: moeda.nullableString('nome'),
          simbolo: moeda.nullableString('simbolo'),
        }
      : null,
    descricao: obj.nullableString('descricao'),
    observacao: obj.nullableString('observacao'),
  };
}

function mapApportionment(obj: JsonObject): PlantaeEntryApportionment {
  return {
    conta_analitica_id: obj.nullableInt('conta_analitica_id'),
    conta_analitica: obj.nullableString('conta_analitica'),
    conta_analitica_sequencia: obj.nullableString('conta_analitica_sequencia'),
    categoria_contabil_id: obj.nullableInt('categoria_contabil_id'),
    categoria_contabil: obj.nullableString('categoria_contabil'),
    centro_custo_id: obj.nullableInt('centro_custo_id'),
    centro_custo: obj.nullableString('centro_custo'),
    safra_id: obj.nullableInt('safra_id'),
    safra: obj.nullableString('safra'),
    percentual: obj.nullableDecimal('percentual'),
    valor: obj.nullableDecimal('valor'),
  };
}

function mapEntry(obj: JsonObject): PlantaeEntry {
  return {
    parcela_id: obj.int('parcela_id'),
    numero: obj.nullableInt('numero'),
    total_parcelas: obj.nullableInt('total_parcelas'),
    data_vencto: obj.nullableDate('data_vencto'),
    valor: obj.nullableDecimal('valor'),
    total_pago: obj.nullableDecimal('total_pago'),
    total_juros: obj.nullableDecimal('total_juros'),
    total_multa: obj.nullableDecimal('total_multa'),
    total_desconto: obj.nullableDecimal('total_desconto'),
    total_abatido: obj.nullableDecimal('total_abatido'),
    saldo_atual: obj.nullableDecimal('saldo_atual'),
    data_ult_pagto: obj.nullableDate('data_ult_pagto'),
    status: obj.numericCode('status'),
    titulo: mapTitle(obj.object('titulo')),
    pessoa: nullablePerson(obj, 'pessoa'),
    razao_social: obj.opaque('razao_social'),
    rateio: obj.objectArray('rateio').map(mapApportionment),
  };
}

export function parseEntries(body: unknown): ParsedList<PlantaeEntry> {
  return parseList(body, mapEntry);
}

// --- contas -----------------------------------------------------------------

function mapAccount(obj: JsonObject): PlantaeAccount {
  const banco = obj.nullableObject('banco');
  return {
    conta_id: obj.int('conta_id'),
    nome: obj.nullableString('nome'),
    tipo: obj.numericCode('tipo'),
    banco: banco ? { banco_id: banco.int('banco_id'), nome: banco.nullableString('nome') } : null,
    agencia: obj.nullableString('agencia'),
    numero_conta: obj.nullableString('numero_conta'),
    conta_bancaria_id: obj.nullableInt('conta_bancaria_id'),
  };
}

export function parseAccounts(body: unknown): ParsedList<PlantaeAccount> {
  return parseList(body, mapAccount);
}

// --- movimentacoes e extrato ------------------------------------------------

/**
 * `saldo` por linha: o EXTRATO o traz (obrigatorio). A LISTAGEM de movimentacoes
 * NAO o traz - observado na homologacao real (Fase 4.2): a chave simplesmente nao
 * existe, apesar do exemplo da colecao (que reaproveita o esquema do extrato).
 * Na listagem, chave ausente vira `null` ("nao informado"); nunca um saldo inventado.
 */
function mapMovement(obj: JsonObject, saldoObrigatorio: boolean): PlantaeMovement {
  const natureza = obj.textCode('natureza');
  if (natureza.codigo !== 'C' && natureza.codigo !== 'D') {
    throw new PlantaeApiError('invalid-response', {
      where: `${obj.path}.natureza.codigo [C ou D]`,
    });
  }
  const conta = obj.object('conta');
  const contrapartida = obj.nullableObject('conta_contrapartida');
  return {
    mov_conta_id: obj.int('mov_conta_id'),
    cheque_id: obj.nullableInt('cheque_id'),
    data: obj.nullableDate('data'),
    natureza: { codigo: natureza.codigo, descricao: natureza.descricao },
    valor: obj.decimal('valor'),
    conta: {
      conta_id: conta.int('conta_id'),
      nome: conta.nullableString('nome'),
      tipo: conta.nullableNumericCode('tipo'),
    },
    origem: obj.nullableNumericCode('origem'),
    descricao: obj.nullableString('descricao'),
    forma_pagamento: obj.nullableNumericCode('forma_pagamento'),
    numero_cheque: obj.looseNumber('numero_cheque'),
    pessoa: nullablePerson(obj, 'pessoa'),
    titulo_id: obj.nullableInt('titulo_id'),
    parcela_id: obj.nullableInt('parcela_id'),
    conta_contrapartida: contrapartida
      ? {
          conta_id: contrapartida.int('conta_id'),
          nome: contrapartida.nullableString('nome'),
        }
      : null,
    conciliado: obj.boolean('conciliado'),
    data_conciliacao: obj.nullableDate('data_conciliacao'),
    saldo: saldoObrigatorio || obj.has('saldo') ? obj.nullableDecimal('saldo') : null,
  };
}

export function parseMovements(body: unknown): ParsedList<PlantaeMovement> {
  return parseList(body, (item) => mapMovement(item, false));
}

/** Extrato: as movimentacoes mais os saldos do periodo, que vivem em `meta`. */
export function parseStatement(body: unknown): ParsedList<PlantaeMovement> & {
  readonly saldoAnterior: Decimal;
  readonly saldoFinal: Decimal;
} {
  const list = parseList(body, (item) => mapMovement(item, true));
  const meta = list.root.object('meta');
  return {
    ...list,
    saldoAnterior: meta.decimal('saldo_anterior'),
    saldoFinal: meta.decimal('saldo_final'),
  };
}

// --- notas fiscais ----------------------------------------------------------

function mapInvoiceItem(obj: JsonObject): PlantaeInvoiceItem {
  return {
    numero_item: obj.nullableInt('numero_item'),
    produto_id: obj.nullableInt('produto_id'),
    codigo: obj.nullableString('codigo'),
    descricao: obj.nullableString('descricao'),
    ncm: obj.nullableString('ncm'),
    cfop: obj.looseNumber('cfop'),
    unidade: obj.nullableString('unidade'),
    quantidade: obj.nullableDecimal('quantidade'),
    valor_unitario: obj.nullableDecimal('valor_unitario'),
    valor_total: obj.nullableDecimal('valor_total'),
    desconto: obj.nullableDecimal('desconto'),
  };
}

function mapInvoiceTotals(obj: JsonObject): PlantaeInvoiceTotals {
  return {
    total_nota: obj.nullableDecimal('total_nota'),
    valor_produtos: obj.nullableDecimal('valor_produtos'),
    desconto: obj.nullableDecimal('desconto'),
    frete: obj.nullableDecimal('frete'),
    seguro: obj.nullableDecimal('seguro'),
    outros: obj.nullableDecimal('outros'),
    icms: obj.nullableDecimal('icms'),
    icms_st: obj.nullableDecimal('icms_st'),
    ipi: obj.nullableDecimal('ipi'),
    pis: obj.nullableDecimal('pis'),
    cofins: obj.nullableDecimal('cofins'),
    total_imposto: obj.nullableDecimal('total_imposto'),
  };
}

function mapInvoice(obj: JsonObject): PlantaeIssuedInvoice {
  const emitente = obj.object('emitente');
  const destinatario = obj.object('destinatario');
  return {
    nota_fiscal_id: obj.int('nota_fiscal_id'),
    modelo: obj.nullableString('modelo'),
    serie: obj.looseNumber('serie'),
    numero: obj.looseNumber('numero'),
    chave: obj.nullableString('chave'),
    data_emissao: obj.nullableDate('data_emissao'),
    dh_emissao: obj.nullableDateTime('dh_emissao'),
    operacao: obj.nullableTextCode('operacao'),
    finalidade: obj.nullableTextCode('finalidade'),
    natureza: obj.nullableString('natureza'),
    situacao: obj.nullableTextCode('situacao'),
    resposta_sefaz: obj.opaque('resposta_sefaz'),
    cancelamento: obj.opaque('cancelamento'),
    emitente: {
      razao_social_id: emitente.nullableInt('razao_social_id'),
      nome: emitente.nullableString('nome'),
      cpf_cnpj: emitente.nullableString('cpf_cnpj'),
      inscricao_estadual: emitente.nullableString('inscricao_estadual'),
      uf: emitente.nullableString('uf'),
    },
    destinatario: {
      pessoa_id: destinatario.nullableInt('pessoa_id'),
      nome: destinatario.nullableString('nome'),
      cpf_cnpj: destinatario.nullableString('cpf_cnpj'),
      inscricao_estadual: destinatario.nullableString('inscricao_estadual'),
      uf: destinatario.nullableString('uf'),
    },
    totais: mapInvoiceTotals(obj.object('totais')),
    itens: obj.objectArray('itens').map(mapInvoiceItem),
  };
}

export function parseIssuedInvoices(body: unknown): ParsedList<PlantaeIssuedInvoice> {
  return parseList(body, mapInvoice);
}

// --- razoes sociais ---------------------------------------------------------

function mapLegalEntity(obj: JsonObject): PlantaeLegalEntity {
  return {
    razao_social_id: obj.int('razao_social_id'),
    razao_social: obj.nullableString('razao_social'),
    inscricao_estadual: obj.nullableString('inscricao_estadual'),
    cpf_cnpj: obj.nullableString('cpf_cnpj'),
    fazenda: obj.opaque('fazenda'),
  };
}

export function parseLegalEntities(body: unknown): ParsedList<PlantaeLegalEntity> {
  return parseList(body, mapLegalEntity);
}
