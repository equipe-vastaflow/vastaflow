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

  @Column({ name: 'ativo', type: 'boolean', default: true })
  ativo: boolean;

  @ManyToOne(() => Role, { nullable: false })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
