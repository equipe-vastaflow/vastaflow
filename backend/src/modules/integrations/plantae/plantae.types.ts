import type { CodedValue, Decimal, PlantaeOpaque } from './plantae-json';

/**
 * Contratos das respostas da API externa do Plantae.
 *
 * Fonte unica: a colecao Postman oficial "Plantae API Externa". Os nomes dos
 * campos sao os da API (snake_case), preservados de proposito: quem consulta a
 * documentacao encontra o mesmo nome aqui.
 *
 * Regras que valem para todos:
 * - dinheiro e quantidade sao `Decimal` (TEXTO decimal exato), nunca `number`;
 * - `null` e preservado como `null`: nunca vira `0`, `""` nem data fabricada;
 * - campo sem forma documentada (a colecao so mostra `null`) e `PlantaeOpaque`.
 *
 * Nada aqui e gravado: sao dados de consulta, em memoria, durante a requisicao.
 */

// --- /me --------------------------------------------------------------------

export interface PlantaeIntegration {
  readonly id: number;
  readonly nome: string;
  readonly organizacao_id: number;
  /** Escopos liberados para a chave. Os nomes por rota NAO estao na colecao. */
  readonly scopes: readonly string[];
}

// --- pessoas ----------------------------------------------------------------

export interface PlantaePerson {
  readonly pessoa_id: number;
  readonly nome: string | null;
  readonly razao_social: string | null;
  /** Nos exemplos: `F` ou `J`. Preservado como veio. */
  readonly tipo_pessoa: string | null;
  /** Dado pessoal: nunca vai para log. */
  readonly cpf_cnpj: string | null;
}

// --- lancamentos (parcelas) -------------------------------------------------

export interface PlantaeCurrency {
  readonly moeda_id: number;
  readonly nome: string | null;
  readonly simbolo: string | null;
}

export interface PlantaeEntryTitle {
  readonly titulo_id: number;
  readonly tipo: CodedValue<number> | null;
  readonly origem: CodedValue<number> | null;
  readonly num_documento: string | null;
  readonly data_emissao: string | null;
  /** Valor ORIGINAL do titulo, na moeda dele (`moeda`). Nao e o saldo da parcela. */
  readonly valor_total: Decimal | null;
  readonly moeda: PlantaeCurrency | null;
  readonly descricao: string | null;
  readonly observacao: string | null;
}

export interface PlantaeEntryApportionment {
  readonly conta_analitica_id: number | null;
  readonly conta_analitica: string | null;
  readonly conta_analitica_sequencia: string | null;
  readonly categoria_contabil_id: number | null;
  readonly categoria_contabil: string | null;
  readonly centro_custo_id: number | null;
  readonly centro_custo: string | null;
  readonly safra_id: number | null;
  readonly safra: string | null;
  readonly percentual: Decimal | null;
  readonly valor: Decimal | null;
}

/**
 * Uma PARCELA de titulo a pagar/receber (nao um pagamento realizado).
 * `status.codigo`: 0 pendente, 1 quitada, 2 SUBSTITUIDA - que NAO e cancelada
 * (renegociacao ou desmembramento) e nunca e convertida.
 */
export interface PlantaeEntry {
  readonly parcela_id: number;
  readonly numero: number | null;
  readonly total_parcelas: number | null;
  readonly data_vencto: string | null;
  /** Valor da parcela, na moeda do titulo. */
  readonly valor: Decimal | null;
  readonly total_pago: Decimal | null;
  readonly total_juros: Decimal | null;
  readonly total_multa: Decimal | null;
  readonly total_desconto: Decimal | null;
  readonly total_abatido: Decimal | null;
  readonly saldo_atual: Decimal | null;
  readonly data_ult_pagto: string | null;
  readonly status: CodedValue<number>;
  readonly titulo: PlantaeEntryTitle;
  readonly pessoa: PlantaePerson | null;
  /** Sem forma documentada (so `null` nos exemplos). */
  readonly razao_social: PlantaeOpaque;
  readonly rateio: readonly PlantaeEntryApportionment[];
}

// --- contas -----------------------------------------------------------------

export interface PlantaeAccount {
  readonly conta_id: number;
  readonly nome: string | null;
  /** `1` caixa, `2` bancaria, `3` aplicacao, `4` numerario em transito. */
  readonly tipo: CodedValue<number>;
  readonly banco: { readonly banco_id: number; readonly nome: string | null } | null;
  readonly agencia: string | null;
  readonly numero_conta: string | null;
  readonly conta_bancaria_id: number | null;
}

// --- movimentacoes e extrato ------------------------------------------------

export interface PlantaeMovement {
  readonly mov_conta_id: number;
  readonly cheque_id: number | null;
  readonly data: string | null;
  /** `C` credito (entrada) ou `D` debito (saida). */
  readonly natureza: CodedValue<'C' | 'D'>;
  /** Em REAIS. */
  readonly valor: Decimal;
  readonly conta: {
    readonly conta_id: number;
    readonly nome: string | null;
    readonly tipo: CodedValue<number> | null;
  };
  readonly origem: CodedValue<number> | null;
  readonly descricao: string | null;
  readonly forma_pagamento: CodedValue<number> | null;
  readonly numero_cheque: string | null;
  readonly pessoa: PlantaePerson | null;
  readonly titulo_id: number | null;
  readonly parcela_id: number | null;
  readonly conta_contrapartida: { readonly conta_id: number; readonly nome: string | null } | null;
  readonly conciliado: boolean;
  readonly data_conciliacao: string | null;
  /**
   * Saldo da conta DEPOIS desta linha. Vem no EXTRATO. Na listagem de movimentacoes
   * a API real nao o envia: aqui fica `null` = "nao informado". Nao some pagina a pagina.
   */
  readonly saldo: Decimal | null;
}

// --- notas fiscais (NF-e modelo 55) -----------------------------------------

export interface PlantaeInvoiceItem {
  readonly numero_item: number | null;
  readonly produto_id: number | null;
  readonly codigo: string | null;
  readonly descricao: string | null;
  readonly ncm: string | null;
  readonly cfop: string | null;
  readonly unidade: string | null;
  readonly quantidade: Decimal | null;
  readonly valor_unitario: Decimal | null;
  readonly valor_total: Decimal | null;
  readonly desconto: Decimal | null;
}

export interface PlantaeInvoiceTotals {
  readonly total_nota: Decimal | null;
  readonly valor_produtos: Decimal | null;
  readonly desconto: Decimal | null;
  readonly frete: Decimal | null;
  readonly seguro: Decimal | null;
  readonly outros: Decimal | null;
  readonly icms: Decimal | null;
  readonly icms_st: Decimal | null;
  readonly ipi: Decimal | null;
  readonly pis: Decimal | null;
  readonly cofins: Decimal | null;
  readonly total_imposto: Decimal | null;
}

/**
 * NF-e modelo 55 EMITIDA, autorizada ou cancelada, de ambiente de PRODUCAO da
 * Plantae. So dados: a API nao entrega XML nem DANFE. Nao e NFS-e.
 */
export interface PlantaeIssuedInvoice {
  readonly nota_fiscal_id: number;
  readonly modelo: string | null;
  readonly serie: string | null;
  readonly numero: string | null;
  /** Chave de acesso (44 digitos). Identificador fiscal: nunca vai para log. */
  readonly chave: string | null;
  readonly data_emissao: string | null;
  readonly dh_emissao: string | null;
  readonly operacao: CodedValue<string> | null;
  readonly finalidade: CodedValue<string> | null;
  readonly natureza: string | null;
  readonly situacao: CodedValue<string> | null;
  /** Sem forma documentada (so `null` nos exemplos). */
  readonly resposta_sefaz: PlantaeOpaque;
  /** Sem forma documentada (so `null` nos exemplos). */
  readonly cancelamento: PlantaeOpaque;
  readonly emitente: {
    readonly razao_social_id: number | null;
    readonly nome: string | null;
    readonly cpf_cnpj: string | null;
    readonly inscricao_estadual: string | null;
    readonly uf: string | null;
  };
  readonly destinatario: {
    readonly pessoa_id: number | null;
    readonly nome: string | null;
    readonly cpf_cnpj: string | null;
    readonly inscricao_estadual: string | null;
    readonly uf: string | null;
  };
  readonly totais: PlantaeInvoiceTotals;
  readonly itens: readonly PlantaeInvoiceItem[];
}

// --- razoes sociais ---------------------------------------------------------

export interface PlantaeLegalEntity {
  readonly razao_social_id: number;
  readonly razao_social: string | null;
  readonly inscricao_estadual: string | null;
  readonly cpf_cnpj: string | null;
  /** Sem forma documentada (so `null` nos exemplos). */
  readonly fazenda: PlantaeOpaque;
}

// --- paginacao --------------------------------------------------------------

/** O que o VastaFlow sabe sobre o resto da listagem. */
export interface PlantaePagination {
  readonly perPage: number | null;
  /** Cursor OPACO da proxima pagina, exatamente como o Plantae enviou. */
  readonly nextCursor: string | null;
  /** `null` = o Plantae nao informou (resposta sem `meta` nem `links`): nunca se afirma que acabou. */
  readonly hasMore: boolean | null;
  readonly pagesFetched: number;
}

export interface PlantaePage<T> {
  readonly items: readonly T[];
  readonly pagination: PlantaePagination;
}

/** Extrato: saldos do PERIODO inteiro, os mesmos em todas as paginas (nunca somados). */
export interface PlantaeStatementPage extends PlantaePage<PlantaeMovement> {
  readonly saldoAnterior: Decimal;
  readonly saldoFinal: Decimal;
}
