import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Permissao granular (ex.: `users:read`).
 *
 * Nomes de tabela/coluna curtos e em snake_case: o limite de identificadores do
 * Oracle e o pior caso (ADR 0001).
 */
@Entity({ name: 'permissions' })
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'code', type: 'varchar', length: 64, unique: true })
  code: string;

  @Column({ name: 'descricao', type: 'varchar', length: 255 })
  descricao: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
