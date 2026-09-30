import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IdentityChannel } from '../external-identity.enums';

/** Tamanhos das colunas; o formato do id externo e validado por canal. */
export const IDENTITY_CHANNEL_MAX_LENGTH = 20;
export const EXTERNAL_ID_MAX_LENGTH = 64;

/**
 * Vinculo entre uma identidade EXTERNA (ex.: conta do Telegram) e um usuario
 * interno do VastaFlow.
 *
 * E so a ponte: nao guarda perfil, permissao, nome, token nem mensagem. A cada
 * mensagem, o usuario e relido do banco pela mesma regra do `JwtAuthGuard` -
 * desativar a conta ou trocar o perfil vale na hora, sem mexer no vinculo.
 *
 * `(canal, id_externo)` e UNICO no banco: uma conta do Telegram pertence a um so
 * usuario, e duas vinculacoes simultaneas da mesma conta nao passam as duas -
 * a segunda cai no indice. Um usuario pode ter varios vinculos.
 *
 * `usuario_id` sem chave estrangeira, pelo mesmo motivo de
 * `audit_logs.usuario_id`, `financial_entries.criado_por_id` e
 * `notifications.usuario_id`. Usuario inexistente e tratado como "nao vinculado"
 * pelo resolvedor.
 *
 * Nomes curtos e em `snake_case` pelo limite de identificador do Oracle (ADR 0001).
 */
@Entity({ name: 'external_identity_links' })
@Index('ux_ext_ident_canal_id', ['canal', 'idExterno'], { unique: true })
export class ExternalIdentityLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'canal', type: 'varchar', length: IDENTITY_CHANNEL_MAX_LENGTH })
  canal: IdentityChannel;

  /** Id no canal, sempre como texto. No Telegram, o id numerico do usuario. */
  @Column({ name: 'id_externo', type: 'varchar', length: EXTERNAL_ID_MAX_LENGTH })
  idExterno: string;

  /** Usuario interno. Indexado: a listagem dos vinculos e sempre por usuario. */
  @Index('ix_ext_ident_usuario')
  @Column({ name: 'usuario_id', type: 'varchar', length: 36 })
  usuarioId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
