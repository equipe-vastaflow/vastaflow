/**
 * Por que uma chamada ao Plantae falhou. Categorias FIXAS: nenhum texto vindo
 * do Plantae (nem do `fetch`) entra aqui.
 */
export type PlantaeFailure =
  | 'disabled'
  | 'not-configured'
  | 'unauthorized'
  | 'forbidden'
  | 'rejected-parameters'
  | 'rate-limited'
  | 'timeout'
  | 'dns'
  | 'connection-refused'
  | 'tls'
  | 'network'
  | 'redirect'
  | 'server-error'
  | 'http'
  | 'invalid-response'
  | 'response-too-large'
  | 'pagination-inconsistent'
  | 'cursor-loop';

export interface PlantaeFailureDetail {
  readonly httpStatus?: number;
  /** Segundos ate repetir, quando o Plantae (ou o limitador local) informou. */
  readonly retryAfterSeconds?: number;
  /** Nomes de PARAMETROS que o Plantae rejeitou (422). Nunca as mensagens nem os valores. */
  readonly parameters?: readonly string[];
  /** Caminho do campo que violou o contrato (ex.: `data[0].valor`). Nunca o valor. */
  readonly where?: string;
}

/**
 * Falha de uma chamada ao Plantae.
 *
 * A mensagem e montada AQUI, so com a categoria, o status HTTP e o caminho do
 * campo. O erro original do `fetch` e descartado (nem como `cause`): pode trazer
 * a URL, e o corpo do Plantae pode trazer CPF/CNPJ e valores financeiros.
 */
export class PlantaeApiError extends Error {
  constructor(
    readonly kind: PlantaeFailure,
    readonly detail: PlantaeFailureDetail = {},
  ) {
    super(
      `Plantae falhou: ${kind}` +
        (detail.httpStatus === undefined ? '' : ` ${String(detail.httpStatus)}`) +
        (detail.where === undefined ? '' : ` em ${detail.where}`),
    );
    this.name = 'PlantaeApiError';
  }
}

/** Parametros de consulta invalidos, detectados ANTES de qualquer chamada externa. */
export class PlantaeInputError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Parametros invalidos: ${problems.join('; ')}`);
    this.name = 'PlantaeInputError';
  }
}
