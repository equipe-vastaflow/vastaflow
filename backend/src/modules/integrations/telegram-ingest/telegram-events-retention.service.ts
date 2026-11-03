import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import type { AuditService } from '../../audit/audit.service';
import {
  EVENT_RETENTION_MIN_DAYS,
  RETENTION_INITIAL_DELAY_MS,
  RETENTION_INTERVAL_MS,
} from './telegram-events.policy';
import type { TelegramInboundEventsRepository } from './telegram-inbound-events.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retencao automatica de `telegram_inbound_events` (a mesma regra do CLI `purge`, agora agendada).
 *
 * - Opt-in: `TELEGRAM_EVENTS_PURGE_ENABLED=true`. Desligada, nao agenda nada.
 * - Apaga SO eventos terminais (`CONCLUIDO`, `FALHOU`, `ABANDONADO`) com mais de
 *   `TELEGRAM_EVENTS_RETENTION_DAYS` dias (piso `EVENT_RETENTION_MIN_DAYS`). Nunca `PROCESSANDO`, e
 *   nenhuma outra tabela: financeiro, documentos, auditoria e vinculos nao sao tocados.
 * - Fora do caminho das mensagens: um timer proprio (`unref`, sem laco apertado) roda 1 vez por dia, nunca
 *   duas execucoes ao mesmo tempo, e QUALQUER falha e engolida e registrada so com o nome do erro. Um
 *   evento recente nunca e apagado, entao a idempotencia do recebimento permanece intacta.
 * - Log e auditoria so com numeros (quantidade, dias): nenhum conteudo, id do Telegram ou segredo.
 *   Auditoria (`TELEGRAM_EVENT_ADMIN`) so quando algo foi apagado, para nao poluir a trilha com dias vazios.
 */
export class TelegramEventsRetentionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramEventsRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<number | null> | null = null;
  private stopped = false;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly events: TelegramInboundEventsRepository,
    private readonly audit: Pick<AuditService, 'record'>,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('TELEGRAM_EVENTS_PURGE_ENABLED', { infer: true }) !== true) {
      return;
    }
    if (this.retentionDays() === null) {
      this.logger.warn('Telegram: retencao de eventos nao iniciada (prazo invalido)');
      return;
    }
    this.schedule(RETENTION_INITIAL_DELAY_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }

  /**
   * Uma passada. Devolve quantos eventos apagou, ou `null` se nao rodou (prazo invalido, ja em
   * execucao ou falha). Nunca lanca.
   */
  runOnce(): Promise<number | null> {
    if (this.inFlight !== null) {
      return Promise.resolve(null);
    }
    this.inFlight = this.purge().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async purge(): Promise<number | null> {
    const days = this.retentionDays();
    if (days === null) {
      return null;
    }
    try {
      const before = new Date(this.now().getTime() - days * DAY_MS);
      const removed = await this.events.purgeTerminalBefore(before);
      if (removed > 0) {
        this.logger.log(
          `Telegram: ${String(removed)} evento(s) antigo(s) removido(s) (retencao de ${String(days)} dias)`,
        );
        await this.audit.record({
          acao: AuditAction.TelegramEventAdmin,
          modulo: AuditModuleName.Channels,
          descricao: 'Limpeza automatica de eventos do Telegram',
          metadados: { operacao: 'limpar', origem: 'agendada', quantidade: removed, dias: days },
        });
      }
      return removed;
    } catch (error) {
      this.logger.warn(
        `Telegram: limpeza de eventos falhou (${error instanceof Error ? error.name : typeof error})`,
      );
      return null;
    }
  }

  /** Dias de retencao, ou `null` se o valor for invalido ou abaixo do piso (nunca apaga com prazo curto). */
  private retentionDays(): number | null {
    const days = Number(this.config.get('TELEGRAM_EVENTS_RETENTION_DAYS', { infer: true }));
    return Number.isInteger(days) && days >= EVENT_RETENTION_MIN_DAYS ? days : null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce().finally(() => {
        this.schedule(RETENTION_INTERVAL_MS);
      });
    }, delayMs);
    // O timer nunca segura o processo vivo nem atrasa o shutdown.
    this.timer.unref();
  }
}
