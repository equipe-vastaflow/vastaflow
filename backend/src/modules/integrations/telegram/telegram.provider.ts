import { Injectable, Logger } from '@nestjs/common';
import type { HealthIndicatorResult } from '../../health/health.types';
import { IntegrationCategory, IntegrationStatus } from '../integration.enums';
import type { IntegrationMetadata, IntegrationProvider } from '../integration.types';
import { TelegramApiClient, TelegramApiError } from './telegram-api.client';

/**
 * O Telegram visto pela foundation de integracoes (`IntegrationRegistry`).
 *
 * - `metadata`: so identidade publica. Nenhum dado do bot, nenhum token;
 * - `getStatus`: local, sem rede - `READY` com token, `NOT_CONFIGURED` sem;
 * - `healthCheck`: chama `getMe`, com o timeout do cliente. So roda quando o
 *   registro o pede e a integracao esta `READY`; o boot nunca depende dele.
 *
 * A mensagem publica do health e decidida pelo registro, que descarta o
 * `detail` do provider - por isso nao ha `detail` aqui.
 */
@Injectable()
export class TelegramProvider implements IntegrationProvider {
  private readonly logger = new Logger(TelegramProvider.name);

  readonly metadata: IntegrationMetadata = {
    id: 'telegram',
    name: 'Telegram',
    category: IntegrationCategory.Messaging,
  };

  constructor(private readonly client: TelegramApiClient) {}

  getStatus(): Promise<IntegrationStatus> {
    return Promise.resolve(
      this.client.isConfigured() ? IntegrationStatus.Ready : IntegrationStatus.NotConfigured,
    );
  }

  async healthCheck(): Promise<HealthIndicatorResult> {
    try {
      await this.client.getMe();
      return { status: 'ok' };
    } catch (error) {
      if (!(error instanceof TelegramApiError)) {
        throw error;
      }
      // Mensagem montada pelo cliente: metodo, categoria e status HTTP - sem token.
      this.logger.warn(`Telegram: health check falhou (${error.message})`);
      return { status: 'down' };
    }
  }
}
