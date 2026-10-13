import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';

/**
 * Estado de um evento recebido.
 *
 * - `PROCESSANDO`: reservado por uma entrega; o comando esta (ou estava) sendo
 *   avaliado. Uma segunda entrega do mesmo update NAO executa de novo;
 * - `CONCLUIDO`: avaliado e respondido ao n8n;
 * - `FALHOU`: a avaliacao quebrou. Tambem NAO e reexecutada (ver abaixo).
 */
export enum InboundEventStatus {
  Processando = 'PROCESSANDO',
  Concluido = 'CONCLUIDO',
  Falhou = 'FALHOU',
  /**
   * Terminal EXPLICITO: um operador revisou um evento que ficou em `PROCESSANDO` (queda
   * no meio) e o encerrou. Continua reservando `(canal, bot, update)` - o update NAO
   * volta a ser executado. Ver `docs/telegram-n8n.md` (eventos presos).
   */
  Abandonado = 'ABANDONADO',
}

/**
 * Inteiro grande em coluna `decimal(20,0)` (nao `bigint`: o driver Oracle do TypeORM
 * recusa `bigint` - ver `documents/entities/size.transformer.ts`). O MySQL devolve
 * decimal como TEXTO; aqui volta sempre como `number`. Os `update_id` do Telegram
 * ficam muito abaixo de 2^53.
 */
const integerTransformer: ValueTransformer = {
  to: (value: number): number => Math.trunc(value),
  from: (value: unknown): number => {
    const numero = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numero) ? numero : 0;
  },
};

/**
 * Registro de uma mensagem do Telegram JA entregue ao backend. Existe para uma
 * unica coisa: a mesma mensagem nunca executa um comando duas vezes.
 *
 * IDEMPOTENCIA PERSISTENTE. `(canal, bot_id, update_id)` e UNICO no banco. O
 * `update_id` e unico por bot no Telegram, e o `bot_id` entra na chave para que a
 * troca do bot nao colida com o historico. A reserva e um `INSERT`: quando duas
 * entregas chegam juntas, o indice deixa passar UMA, e a outra e tratada como
 * duplicada. Nada disso depende de memoria do processo - sobrevive a reinicio,
 * a varias instancias e a retry do n8n.
 *
 * POLITICA: no maximo UMA execucao por mensagem ("at-most-once"). Se o backend cair
 * depois de reservar e antes de responder, a mensagem NAO e reexecutada: a pessoa
 * reenvia (um update novo). Reexecutar automaticamente poderia repetir um comando
 * com efeito colateral; hoje todos so leem, mas a regra vale para os futuros.
 *
 * NAO guarda texto da mensagem, resposta, nome nem dado de negocio: so ids e o
 * desfecho. Linha pequena e de vida curta; a coluna `created_at` e indexada para
 * uma retencao futura (apagar o antigo) sem varrer a tabela.
 *
 * Nomes curtos e em `snake_case` pelo limite de identificador do Oracle (ADR 0001).
 */
@Entity({ name: 'telegram_inbound_events' })
@Index('ux_tg_evt_bot_update', ['canal', 'botId', 'updateId'], { unique: true })
@Index('ix_tg_evt_created', ['createdAt'])
export class TelegramInboundEvent {
  /** Tambem e o identificador de correlacao devolvido ao n8n e gravado na auditoria. */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'canal', type: 'varchar', length: 20 })
  canal: string;

  @Column({ name: 'bot_id', type: 'varchar', length: 20 })
  botId: string;

  @Column({
    name: 'update_id',
    type: 'decimal',
    precision: 20,
    scale: 0,
    transformer: integerTransformer,
  })
  updateId: number;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: InboundEventStatus;

  /** Desfecho tecnico (`EXECUTED`, `UNLINKED`...). Nunca conteudo. */
  @Column({ name: 'resultado', type: 'varchar', length: 30, nullable: true })
  resultado: string | null;

  /** Usuario interno resolvido, quando houve. Sem chave estrangeira, como nas demais tabelas. */
  @Column({ name: 'usuario_id', type: 'varchar', length: 36, nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
