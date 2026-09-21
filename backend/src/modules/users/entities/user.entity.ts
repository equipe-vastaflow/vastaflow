import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../roles/entities/role.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'nome', type: 'varchar', length: 120 })
  nome: string;

  /** Sempre armazenado em minusculas (normalizado pelo UsersService). */
  @Column({ name: 'email', type: 'varchar', length: 254, unique: true })
  email: string;

  /** Hash bcrypt (60 caracteres). A senha em texto puro nunca e persistida. */
  @Column({ name: 'senha_hash', type: 'varchar', length: 100 })
  senhaHash: string;

  /**
   * `type: Boolean` (o construtor, nao a string `'boolean'`): e o que faz o
   * TypeORM escolher o tipo nativo de cada banco E converter o valor nos dois
   * sentidos - `tinyint` no MySQL, `NUMBER` com 1/0 no Oracle (que so tem
   * BOOLEAN a partir do 23ai). A string `'boolean'` e rejeitada pelo driver
   * Oracle; `'number'` subiria, mas devolveria 1/0 em vez de true/false.
   */
  @Column({ name: 'ativo', type: Boolean, default: true })
  ativo: boolean;

  @ManyToOne(() => Role, { nullable: false })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
