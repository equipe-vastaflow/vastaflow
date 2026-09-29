import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationType } from '../notification.enums';

/** Tamanhos das colunas de texto; os DTOs e o `createForUser` validam contra eles. */
export const TITLE_MAX_LENGTH = 120;
export const MESSAGE_MAX_LENGTH = 500;

/**
 * Aviso interno destinado a UM usuario.
 *
 * Interna de verdade: nao ha e-mail, push, WhatsApp nem Telegram nesta etapa.
 * A notificacao nasce de dentro do sistema (`NotificationsService.createForUser`)
 * e e lida pelo proprio destinatario na tela `/notifications`.
 *
 * `usuario_id` e o destinatario e vem SEMPRE do JWT nas rotas do usuario - o
 * cliente nunca informa para quem e a notificacao.
 *
 * Coluna simples, sem chave estrangeira, pelo mesmo motivo de
 * `audit_logs.usuario_id`, `financial_entries.criado_por_id` e
 * `system_settings.atualizado_por_id`: o registro nao deve depender do cadastro
 * de usuarios para continuar valido.
 *
 * Nomes curtos e em `snake_case` pelo limite de identificador do Oracle (ADR 0001).
 *
 * `ix_notif_dest` e o unico indice da tabela, e e exatamente o da consulta que
 * a tela faz: as notificacoes de um usuario, nao lidas primeiro, das mais
 * recentes para as mais antigas. O mesmo indice atende o `COUNT` de nao lidas,
 * que usa so o prefixo (`usuario_id`, `lida`). A busca individual ja e servida
 * pela chave primaria - nenhum indice especulativo foi criado.
 */
@Entity({ name: 'notifications' })
@Index('ix_notif_dest', ['usuarioId', 'lida', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Destinatario. Nunca vem do cliente: e o `id` do usuario autenticado. */
  @Column({ name: 'usuario_id', type: 'varchar', length: 36 })
  usuarioId: string;

  @Column({ name: 'titulo', type: 'varchar', length: TITLE_MAX_LENGTH })
  titulo: string;

  @Column({ name: 'mensagem', type: 'varchar', length: MESSAGE_MAX_LENGTH })
  mensagem: string;

  @Column({ name: 'tipo', type: 'varchar', length: 10 })
  tipo: NotificationType;

  /**
   * `type: Boolean` (o construtor, nao a string `'boolean'`): e o que faz o
   * TypeORM escolher o tipo nativo de cada banco E converter o valor nos dois
   * sentidos - `tinyint` no MySQL, `NUMBER` 1/0 no Oracle. Mesmo criterio de
   * `User.ativo`, e coberto pelo teste de compatibilidade.
   *
   * Como `false` grava 0 e `true` grava 1 nos tres drivers, ordenar por `lida`
   * ascendente coloca as nao lidas primeiro em qualquer banco.
   */
  @Column({ name: 'lida', type: Boolean, default: false })
  lida: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Quando a notificacao foi marcada como lida. `null` enquanto `lida` e falso.
   *
   * Gravado uma unica vez, pelo UPDATE direcionado de `NotificationsRepository`
   * (`WHERE lida = 0`): marcar de novo nao alcanca a linha e nao muda o horario.
   *
   * `type: Date` com precisao 6: o mesmo tipo que o driver escolhe para
   * `created_at` - `datetime(6)` no MySQL, `timestamp(6)` no Oracle.
   */
  @Column({ name: 'read_at', type: Date, precision: 6, nullable: true })
  readAt: Date | null;
}
