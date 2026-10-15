import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** `PROCESSANDO` -> `CONCLUIDO` | `FALHOU`. Mesma politica at-most-once do Telegram. */
export enum WhatsappEventStatus {
  Processando = 'PROCESSANDO',
  Concluido = 'CONCLUIDO',
  Falhou = 'FALHOU',
}

/**
 * Mensagem do WhatsApp JA recebida (idempotencia). A Meta REENTREGA o webhook quando nao recebe 200
 * a tempo; `(phone_number_id, message_id)` e UNICO, entao o mesmo `wamid` executa um comando UMA vez,
 * inclusive sob corrida. Sem texto, sem resposta, sem telefone: so ids e o desfecho.
 */
@Entity({ name: 'whatsapp_inbound_events' })
@Index('ux_wa_evt_msg', ['phoneNumberId', 'messageId'], { unique: true })
@Index('ix_wa_evt_created', ['createdAt'])
export class WhatsappInboundEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'phone_number_id', type: 'varchar', length: 20 })
  phoneNumberId: string;

  @Column({ name: 'message_id', type: 'varchar', length: 200 })
  messageId: string;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: WhatsappEventStatus;

  @Column({ name: 'resultado', type: 'varchar', length: 30, nullable: true })
  resultado: string | null;

  @Column({ name: 'usuario_id', type: 'varchar', length: 36, nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
