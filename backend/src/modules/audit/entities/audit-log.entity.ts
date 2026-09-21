import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Registro imutavel de uma acao relevante.
 *
 * `usuario_id` e uma coluna simples, sem chave estrangeira: a trilha de
 * auditoria deve sobreviver a qualquer alteracao futura na tabela de usuarios
 * e tambem registra eventos sem usuario (ex.: login com e-mail inexistente).
 */
@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('ix_audit_usuario')
  @Column({ name: 'usuario_id', type: 'varchar', length: 36, nullable: true })
  usuarioId: string | null;

  @Column({ name: 'acao', type: 'varchar', length: 30 })
  acao: string;

  @Column({ name: 'modulo', type: 'varchar', length: 30 })
  modulo: string;

  @Column({ name: 'descricao', type: 'varchar', length: 500 })
  descricao: string;

  /** Cabe um IPv6 completo (45 caracteres). */
  @Column({ name: 'ip', type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Index('ix_audit_created')
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
