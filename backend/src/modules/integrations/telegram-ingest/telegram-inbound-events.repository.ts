import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { isUniqueViolation } from '../../../database/unique-violation';
import { InboundEventStatus, TelegramInboundEvent } from './telegram-inbound-event.entity';

@Injectable()
export class TelegramInboundEventsRepository {
  constructor(
    @InjectRepository(TelegramInboundEvent)
    private readonly repository: Repository<TelegramInboundEvent>,
  ) {}

  /**
   * Reserva o update para ESTA entrega.
   *
   * @returns o evento reservado, ou `null` se `(canal, bot, update)` ja foi
   *   reservado antes (entrega duplicada). Quem decide e o indice UNICO do banco,
   *   nao uma consulta previa: sob corrida, so uma insercao passa.
   */
  async claim(
    canal: string,
    botId: string,
    updateId: number,
  ): Promise<TelegramInboundEvent | null> {
    try {
      return await this.repository.save(
        this.repository.create({
          canal,
          botId,
          updateId,
          status: InboundEventStatus.Processando,
          resultado: null,
          usuarioId: null,
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Fecha o evento com o desfecho tecnico. */
  async finish(
    id: string,
    status: InboundEventStatus.Concluido | InboundEventStatus.Falhou,
    resultado: string,
    usuarioId: string | null,
  ): Promise<void> {
    await this.repository.update({ id }, { status, resultado, usuarioId });
  }

  /** Contagem por status (diagnostico). Sem conteudo: so numeros. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.repository
      .createQueryBuilder('e')
      .select('e.status', 'status')
      .addSelect('COUNT(*)', 'total')
      .groupBy('e.status')
      .getRawMany<{ status: string; total: string | number }>();
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
  }

  /**
   * Eventos em `PROCESSANDO` reservados ha mais tempo que `olderThan`: o processo
   * caiu (ou travou) depois de reservar e antes de fechar. Do mais antigo ao mais novo.
   */
  findStuck(olderThan: Date, limit = 50): Promise<TelegramInboundEvent[]> {
    return this.repository.find({
      where: { status: InboundEventStatus.Processando, createdAt: LessThan(olderThan) },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Encerra um evento preso, SEM reexecutar nada. So age sobre `PROCESSANDO` mais
   * antigo que `olderThan`; qualquer outro caso devolve `false`. A reserva permanece:
   * o update continua contando como ja visto.
   */
  async abandon(id: string, olderThan: Date): Promise<boolean> {
    const result = await this.repository.update(
      { id, status: InboundEventStatus.Processando, createdAt: LessThan(olderThan) },
      { status: InboundEventStatus.Abandonado, resultado: 'ABANDONED' },
    );
    return (result.affected ?? 0) === 1;
  }

  /** Quantos eventos terminais `purgeTerminalBefore` apagaria (simulacao). */
  countTerminalBefore(before: Date): Promise<number> {
    return this.repository.count({
      where: {
        status: In([
          InboundEventStatus.Concluido,
          InboundEventStatus.Falhou,
          InboundEventStatus.Abandonado,
        ]),
        createdAt: LessThan(before),
      },
    });
  }

  /**
   * Apaga eventos TERMINAIS criados antes de `before`. Nunca toca `PROCESSANDO`
   * (preso exige decisao humana). Quem chama garante `before` distante o bastante para
   * que um update atrasado nao possa mais chegar (ver `EVENT_RETENTION_MIN_DAYS`).
   */
  async purgeTerminalBefore(before: Date): Promise<number> {
    const result = await this.repository.delete({
      status: In([
        InboundEventStatus.Concluido,
        InboundEventStatus.Falhou,
        InboundEventStatus.Abandonado,
      ]),
      createdAt: LessThan(before),
    });
    return result.affected ?? 0;
  }

  /** Para os testes e para diagnostico: o evento de um update. */
  findByUpdate(
    canal: string,
    botId: string,
    updateId: number,
  ): Promise<TelegramInboundEvent | null> {
    return this.repository.findOne({ where: { canal, botId, updateId } });
  }
}
