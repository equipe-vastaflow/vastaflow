import { Injectable, Logger } from '@nestjs/common';
import type { HealthIndicatorResult, HealthStatus } from '../health/health.types';
import { IntegrationCategory, IntegrationStatus } from './integration.enums';
import type {
  IntegrationHealthReport,
  IntegrationMetadata,
  IntegrationProvider,
  IntegrationStatusReport,
} from './integration.types';

/** Minusculas, digitos e hifen, comecando por letra: `telegram`, `whatsapp`, `nfse`. */
const ID_FORMAT = /^[a-z][a-z0-9-]{0,39}$/;

const HEALTH_STATUSES: readonly HealthStatus[] = ['ok', 'degraded', 'down'];

/**
 * Unicas mensagens de health que o registro expoe - uma por estado, escritas
 * aqui. O `detail` devolvido pelo provider e DESCARTADO: texto livre de um
 * provider pode trazer URL, token, cabecalho ou a resposta bruta do servico, e
 * nenhum filtro de texto garante pegar todo formato de segredo.
 */
const HEALTH_DETAIL: Readonly<Record<HealthStatus, string>> = {
  ok: 'disponivel',
  degraded: 'disponivel com restricoes',
  down: 'indisponivel',
};

/** Resposta quando o proprio health check lanca excecao (a mesma do `HealthService`). */
const HEALTH_CHECK_FAILED: HealthIndicatorResult = { status: 'down', detail: 'verificacao falhou' };

/** Dois providers com o mesmo identificador. Erro de programacao: derruba o boot. */
export class DuplicateIntegrationError extends Error {
  constructor(id: string) {
    super(`Integracao duplicada no registro: '${id}'`);
    this.name = 'DuplicateIntegrationError';
  }
}

/** Nenhum provider registrado com esse identificador. */
export class UnknownIntegrationError extends Error {
  constructor(id: string) {
    super(`Integracao nao registrada: '${id}'`);
    this.name = 'UnknownIntegrationError';
  }
}

/**
 * Registro das integracoes disponiveis: unica fonte de verdade sobre quais
 * existem. Mesmo arranjo do `CommandCatalog`.
 *
 * Nao conhece nenhum fornecedor. Cada integracao futura sera um modulo proprio
 * (ex.: `TelegramModule`) que importa o `IntegrationsModule` e registra o seu
 * provider no `onModuleInit` - o registro nunca importa o provider, entao nao
 * ha ciclo e nenhum fornecedor depende de outro.
 *
 * Registrar e listar nao executam nada do provider: nenhuma chamada externa
 * acontece no boot. `getStatus` e `healthCheck` so rodam quando alguem pede.
 *
 * O que sai daqui e sempre uma copia com campos escolhidos a dedo (id, nome,
 * categoria, estado, resultado do health check). Um provider que guarde o
 * token num campo proprio nao tem como faze-lo aparecer num relatorio.
 */
@Injectable()
export class IntegrationRegistry {
  private readonly logger = new Logger(IntegrationRegistry.name);
  private readonly providers = new Map<string, IntegrationProvider>();

  /**
   * @throws DuplicateIntegrationError identificador ja registrado.
   * @throws Error identificador, nome ou categoria invalidos - erro de
   *   programacao, detectado no boot em vez de em producao.
   */
  register(provider: IntegrationProvider): void {
    const { id, name, category } = provider.metadata;
    if (!ID_FORMAT.test(id)) {
      throw new Error(`Identificador de integracao invalido: '${id}'`);
    }
    if (name.trim() === '') {
      throw new Error(`Integracao '${id}' sem nome`);
    }
    if (!Object.values(IntegrationCategory).includes(category)) {
      throw new Error(`Integracao '${id}' com categoria desconhecida`);
    }
    if (this.providers.has(id)) {
      throw new DuplicateIntegrationError(id);
    }
    this.providers.set(id, provider);
  }

  /** `undefined` quando nenhuma integracao atende por esse identificador. */
  find(id: string): IntegrationProvider | undefined {
    return this.providers.get(id);
  }

  /** Identidade de todas as integracoes registradas, ordenadas por id. */
  all(): readonly IntegrationMetadata[] {
    return [...this.providers.values()]
      .map(({ metadata }) => toMetadata(metadata))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Estado operacional, sem health check. Se o proprio `getStatus` falhar, a
   * integracao aparece como `ERROR` - uma falha de um provider nao derruba quem
   * perguntou.
   *
   * @throws UnknownIntegrationError
   */
  async status(id: string): Promise<IntegrationStatusReport> {
    const provider = this.providerOrThrow(id);
    return { ...toMetadata(provider.metadata), status: await this.safeStatus(provider) };
  }

  /**
   * Estado + health check. O health check so e tentado com a integracao em
   * `READY`; nos demais estados `health` vem `null` e o provider nem e chamado.
   *
   * @throws UnknownIntegrationError
   */
  async healthCheck(id: string): Promise<IntegrationHealthReport> {
    const provider = this.providerOrThrow(id);
    const status = await this.safeStatus(provider);
    const health = status === IntegrationStatus.Ready ? await this.safeHealth(provider) : null;
    return { ...toMetadata(provider.metadata), status, health };
  }

  private providerOrThrow(id: string): IntegrationProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new UnknownIntegrationError(id);
    }
    return provider;
  }

  private async safeStatus(provider: IntegrationProvider): Promise<IntegrationStatus> {
    try {
      const status = await provider.getStatus();
      return Object.values(IntegrationStatus).includes(status) ? status : IntegrationStatus.Error;
    } catch (error) {
      this.logFailure(`obter o estado da integracao '${provider.metadata.id}'`, error);
      return IntegrationStatus.Error;
    }
  }

  private async safeHealth(provider: IntegrationProvider): Promise<HealthIndicatorResult> {
    try {
      const result = await provider.healthCheck();
      const status = HEALTH_STATUSES.includes(result.status) ? result.status : 'down';
      // So o estado vem do provider; a mensagem e sempre a do registro.
      return { status, detail: HEALTH_DETAIL[status] };
    } catch (error) {
      this.logFailure(`verificar a integracao '${provider.metadata.id}'`, error);
      return { ...HEALTH_CHECK_FAILED };
    }
  }

  /**
   * Registra so o NOME do erro, nunca a mensagem nem a pilha: o erro de um
   * cliente HTTP costuma trazer a URL chamada, e a URL pode carregar o token.
   */
  private logFailure(acao: string, error: unknown): void {
    const tipo = error instanceof Error ? error.name : typeof error;
    this.logger.error(`Falha ao ${acao} (${tipo})`);
  }
}

/** Copia apenas os campos publicos da identidade. */
function toMetadata({ id, name, category }: IntegrationMetadata): IntegrationMetadata {
  return { id, name, category };
}
