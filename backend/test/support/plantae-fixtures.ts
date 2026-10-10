/**
 * Fixtures SANITIZADAS da API do Plantae, para testes.
 *
 * - Tudo e ficticio: nomes "Pessoa Ficticia", CPF/CNPJ de preenchimento
 *   (`000.000.000-00`), ids pequenos. Nada foi copiado da colecao real nem do
 *   ambiente de homologacao da cliente.
 * - JSON como TEXTO, nao como objeto: o formato exato dos numeros (`8337.10`, com
 *   o zero final) e parte do que o parser precisa preservar, e um literal de
 *   objeto o perderia.
 * - A FORMA segue a colecao oficial "Plantae API Externa". Os valores nao.
 */

export const BASE_URL = 'https://rc.plantae.agr.br/api/v1/external';

/** Token FALSO, com formato plausivel. Nao e (nem se parece com) uma chave real. */
export const FAKE_TOKEN = 'plt_TOKEN_FALSO_apenas_para_testes_0123456789abcdef';

export const ME_JSON = JSON.stringify({
  data: {
    id: 5421,
    nome: 'Integracao Ficticia',
    organizacao_id: 7432,
    scopes: ['financial-entries:read', 'issued-invoices:read'],
  },
});

interface ListOptions {
  /** Caminho do endpoint no `links.next` (sem a base). */
  readonly endpoint?: string;
  readonly nextCursor?: string | null;
  /** Inclui o objeto `links`. Padrao: sim. */
  readonly withLinks?: boolean;
  /** Inclui o objeto `meta`. Padrao: sim. */
  readonly withMeta?: boolean;
  readonly perPage?: number;
  /** Campos extras em `meta` (ex.: saldos do extrato), ja como texto JSON. */
  readonly metaExtra?: string;
  /** Substitui o `links.next` inteiro (para testar destino invalido). */
  readonly linkNextOverride?: string | null;
}

/** Monta `{ data: [...], links: {...}, meta: {...} }` a partir de itens ja serializados. */
export function listJson(items: readonly string[], options: ListOptions = {}): string {
  const {
    endpoint = 'financial/entries',
    nextCursor = null,
    withLinks = true,
    withMeta = true,
    perPage = 100,
    metaExtra = '',
    linkNextOverride,
  } = options;
  const next =
    linkNextOverride !== undefined
      ? linkNextOverride
      : nextCursor === null
        ? null
        : `${BASE_URL}/${endpoint}?per_page=${String(perPage)}&cursor=${nextCursor}`;
  const parts = [`"data":[${items.join(',')}]`];
  if (withLinks) {
    parts.push(
      `"links":{"first":null,"last":null,"prev":null,"next":${next === null ? 'null' : JSON.stringify(next)}}`,
    );
  }
  if (withMeta) {
    parts.push(
      `"meta":{${metaExtra === '' ? '' : `${metaExtra},`}"path":"${BASE_URL}/${endpoint}",` +
        `"per_page":${String(perPage)},"next_cursor":${nextCursor === null ? 'null' : JSON.stringify(nextCursor)},"prev_cursor":null}`,
    );
  }
  return `{${parts.join(',')}}`;
}

export function personJson(id = 6990): string {
  return (
    `{"pessoa_id":${String(id)},"nome":"Pessoa Ficticia ${String(id)}","razao_social":null,` +
    `"tipo_pessoa":"F","cpf_cnpj":"000.000.000-00"}`
  );
}

export function entryJson(
  id = 482,
  overrides: { valor?: string; statusCode?: number } = {},
): string {
  return (
    `{"parcela_id":${String(id)},"numero":1,"total_parcelas":3,"data_vencto":"2026-09-10",` +
    `"valor":${overrides.valor ?? '8337.10'},"total_pago":0.00,"total_juros":null,"total_multa":null,` +
    `"total_desconto":null,"total_abatido":null,"saldo_atual":8337.10,"data_ult_pagto":null,` +
    `"status":{"codigo":${String(overrides.statusCode ?? 2)},"descricao":"Substituida"},` +
    `"titulo":{"titulo_id":1293,"tipo":{"codigo":1,"descricao":"Duplicata"},` +
    `"origem":{"codigo":3,"descricao":"Compra"},"num_documento":"DOC-001","data_emissao":"2026-08-01",` +
    `"valor_total":25011.30,"moeda":{"moeda_id":1,"nome":"Real","simbolo":"R$"},` +
    `"descricao":"Titulo ficticio","observacao":null},` +
    `"pessoa":${personJson()},"razao_social":null,` +
    `"rateio":[{"conta_analitica_id":700,"conta_analitica":"Insumos","conta_analitica_sequencia":null,` +
    `"categoria_contabil_id":null,"categoria_contabil":null,"centro_custo_id":7230,"centro_custo":"Lavoura",` +
    `"safra_id":null,"safra":null,"percentual":100.00,"valor":8337.10}]}`
  );
}

export function accountJson(id = 1496): string {
  return (
    `{"conta_id":${String(id)},"nome":"Conta Ficticia","tipo":{"codigo":2,"descricao":"Conta bancaria"},` +
    `"banco":{"banco_id":5085,"nome":"Banco Ficticio"},"agencia":"0000","numero_conta":"00000-0",` +
    `"conta_bancaria_id":8266}`
  );
}

export function movementJson(
  id = 2960,
  overrides: { natureza?: string; valor?: string; numeroCheque?: string; semSaldo?: boolean } = {},
): string {
  return (
    `{"mov_conta_id":${String(id)},"cheque_id":null,"data":"2026-09-02",` +
    `"natureza":{"codigo":"${overrides.natureza ?? 'D'}","descricao":"Debito"},` +
    `"valor":${overrides.valor ?? '1503.20'},"conta":{"conta_id":1496,"nome":"Conta Ficticia",` +
    `"tipo":{"codigo":2,"descricao":"Conta bancaria"}},"origem":{"codigo":1,"descricao":"Parcela"},` +
    `"descricao":null,"forma_pagamento":null,"numero_cheque":${overrides.numeroCheque ?? 'null'},` +
    `"pessoa":${personJson()},"titulo_id":352,"parcela_id":1211,"conta_contrapartida":null,` +
    `"conciliado":false,"data_conciliacao":null${overrides.semSaldo ? '' : ',"saldo":9000.80'}}`
  );
}

export function invoiceJson(id = 1446): string {
  return (
    `{"nota_fiscal_id":${String(id)},"modelo":"55","serie":1,"numero":6758,` +
    `"chave":"00000000000000000000000000000000000000000000","data_emissao":"2026-09-03",` +
    `"dh_emissao":"2026-09-03T10:15:30-03:00","operacao":{"codigo":"1","descricao":"Saida"},` +
    `"finalidade":{"codigo":"1","descricao":"Normal"},"natureza":"Venda ficticia",` +
    `"situacao":{"codigo":"1","descricao":"Autorizada"},"resposta_sefaz":null,"cancelamento":null,` +
    `"emitente":{"razao_social_id":155,"nome":"Emitente Ficticio","cpf_cnpj":"00.000.000/0000-00",` +
    `"inscricao_estadual":"000000000","uf":"MT"},` +
    `"destinatario":{"pessoa_id":2775,"nome":"Destinatario Ficticio","cpf_cnpj":"000.000.000-00",` +
    `"inscricao_estadual":null,"uf":"MT"},` +
    `"totais":{"total_nota":8460.66,"valor_produtos":8460.66,"desconto":null,"frete":null,"seguro":null,` +
    `"outros":null,"icms":null,"icms_st":null,"ipi":null,"pis":null,"cofins":null,"total_imposto":null},` +
    `"itens":[{"numero_item":1,"produto_id":9573,"codigo":"P-1","descricao":"Produto ficticio",` +
    `"ncm":"12019000","cfop":5101,"unidade":"SC","quantidade":10.5000,"valor_unitario":805.78,` +
    `"valor_total":8460.66,"desconto":null}]}`
  );
}

export function legalEntityJson(id = 2187): string {
  return (
    `{"razao_social_id":${String(id)},"razao_social":"Razao Social Ficticia","inscricao_estadual":null,` +
    `"cpf_cnpj":"00.000.000/0000-00","fazenda":null}`
  );
}

/** `Response` de teste com o corpo e cabecalhos informados. */
export function jsonResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}
