import type { HealthIndicatorResult } from '../health/health.types';
import type { IntegrationCategory, IntegrationStatus } from './integration.enums';

/**
 * Identidade de uma integracao. Somente dados descritivos e publicos.
 *
 * NAO ha lugar para credencial aqui, nem deve haver: token, senha, API key,
 * segredo de webhook e cabecalho `Authorization` ficam dentro do provider, lidos
 * da configuracao no momento do uso - nunca em um campo que possa ser listado.
 */
export interface IntegrationMetadata {
  /** Estavel e unico no registro. Minusculas, digitos e hifen: `telegram`, `nfse`. */
  readonly id: string;
  /** Nome legivel, para telas e logs. */
  readonly name: string;
  readonly category: IntegrationCategory;
}

/**
 * Contrato de um provider/adapter de integracao externa.
 *
 * Pequeno de proposito: identidade, estado e health check. O que cada
 * integracao FAZ (enviar mensagem, emitir nota, consultar pedido) fica na
 * interface propria dela, definida quando ela existir - nao aqui. Um contrato
 * unico com os metodos de todos os fornecedores obrigaria cada provider a
 * implementar o que nao lhe diz respeito.
 *
 * Regra de dependencia: modulos de negocio dependem de abstracoes; o provider
 * e o unico lugar que conhece SDK, URL e credencial do fornecedor.
 */
export interface IntegrationProvider {
  readonly metadata: IntegrationMetadata;

  /**
   * Estado operacional, decidido LOCALMENTE: configuracao presente, integracao
   * habilitada. Nao faz chamada de rede - e barato e pode ser consultado a
   * qualquer momento. Assincrono para permitir, no futuro, ler a configuracao
   * de outra fonte sem mudar o contrato.
   */
  getStatus(): Promise<IntegrationStatus>;

  /**
   * Verificacao ativa: conectividade, autenticacao, disponibilidade do servico.
   * Reutiliza o vocabulario do `HealthModule` (`ok`/`degraded`/`down`).
   *
   * O registro so chama este metodo com a integracao em `READY`: nao ha o que
   * verificar numa integracao desligada ou sem credencial. Do resultado, o
   * registro aproveita SOMENTE o `status`: o `detail` do provider nunca e
   * exposto - a mensagem publica e fixa, escrita pelo registro, por estado.
   */
  healthCheck(): Promise<HealthIndicatorResult>;
}

/** Estado de uma integracao, como o registro o devolve. Nada alem destes campos. */
export interface IntegrationStatusReport extends IntegrationMetadata {
  readonly status: IntegrationStatus;
}

/**
 * Resultado do health check. `health` e `null` quando a verificacao nao foi
 * tentada porque a integracao nao esta `READY`.
 */
export interface IntegrationHealthReport extends IntegrationStatusReport {
  readonly health: HealthIndicatorResult | null;
}
