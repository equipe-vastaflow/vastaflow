import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../../database/unique-violation';
import { WhatsappEventStatus, WhatsappInboundEvent } from './whatsapp-inbound-event.entity';

@Injectable()
export class WhatsappInboundEventsRepository {
  constructor(
    @InjectRepository(WhatsappInboundEvent)
    private readonly repository: Repository<WhatsappInboundEvent>,
  ) {}

  /**
   * Reserva a mensagem. `null` = ja reservada antes (entrega repetida da Meta). Quem decide e o
   * indice UNICO do banco, nao uma consulta previa.
   */
  async claim(phoneNumberId: string, messageId: string): Promise<WhatsappInboundEvent | null> {
    try {
      return await this.repository.save(
        this.repository.create({
          phoneNumberId,
          messageId,
          status: WhatsappEventStatus.Processando,
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

  async finish(
    id: string,
    status: WhatsappEventStatus.Concluido | WhatsappEventStatus.Falhou,
    resultado: string,
    usuarioId: string | null,
  ): Promise<void> {
    await this.repository.update({ id }, { status, resultado, usuarioId });
  }
}
