import { FinancialEntryStatus, FinancialEntryType } from './financial-entry.enums';

/**
 * Recorte de lancamentos usado pela listagem e pelos relatorios.
 *
 * Estrutura UNICA de propositio: a listagem (`GET /finance/entries`), o resumo e
 * a exportacao aplicam o mesmo recorte, pelo mesmo caminho no repositorio. Dois
 * dialetos de filtro divergiriam no primeiro ajuste.
 *
 * Todos os campos sao opcionais aqui. Quem exige `de` e `ate` e o contrato de
 * relatorio (`report-period.policy.ts`), nao este tipo - a listagem continua
 * aceitando filtro nenhum.
 *
 * `data` e o campo filtrado pelo periodo: e a data do lancamento/vencimento.
 * NAO existe data de pagamento no modelo, e `data` fica congelada quando o
 * lancamento vira PAGO - entao um periodo filtra por quando o lancamento
 * ocorre/vence, nunca por quando foi pago.
 */
export interface FinanceFilter {
  /** Inicio do periodo, `YYYY-MM-DD`, inclusivo. */
  de?: string;
  /** Fim do periodo, `YYYY-MM-DD`, inclusivo. */
  ate?: string;
  status?: FinancialEntryStatus;
  tipo?: FinancialEntryType;
  /**
   * Igualdade exata, como o banco a compara.
   *
   * `categoria` e texto livre (nao ha tabela de categorias), e a comparacao
   * segue a collation da coluna: no MySQL (`utf8mb4_0900_ai_ci`) "Insumos" e
   * "insumos" sao iguais; num banco com collation sensivel a caixa, nao. A
   * diferenca e do banco, nao e corrigida aqui em silencio - ver
   * `docs/arquitetura.md`.
   */
  categoria?: string;
}

/**
 * Extrai do DTO SO os cinco campos do recorte.
 *
 * O DTO da listagem tambem carrega `page`/`limit`, que nao sao recorte. Passar o
 * DTO inteiro ao repositorio funcionaria hoje - a consulta le campo por campo -
 * mas deixaria a porta aberta para paginacao vazar para dentro da clausula
 * `WHERE` num ajuste futuro.
 */
export function toFinanceFilter(source: FinanceFilter): FinanceFilter {
  return {
    de: source.de,
    ate: source.ate,
    status: source.status,
    tipo: source.tipo,
    categoria: source.categoria,
  };
}
