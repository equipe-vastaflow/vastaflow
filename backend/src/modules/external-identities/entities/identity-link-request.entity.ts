import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IdentityChannel, LinkRequestStatus } from '../external-identity.enums';
import { IDENTITY_CHANNEL_MAX_LENGTH } from './external-identity-link.entity';

/**
 * Solicitacao de vinculo PENDENTE de confirmacao pela conta externa.
 *
 * Nao e vinculo: nao autentica ninguem. Vira `ExternalIdentityLink` somente
 * quando a propria conta externa (o remetente da conversa no Telegram) envia o
 * codigo - e e dai, do remetente, que sai o `id_externo`. Por isso esta tabela
 * nao tem `id_externo`: quem inicia a solicitacao nao escolhe qual conta sera
 * vinculada.
 *
 * - `codigo_hash`: SHA-256 do codigo. O codigo em si nunca e gravado. UNICO;
 * - `pendente_chave`: `usuario_id:canal` enquanto `PENDENTE`, nulo depois. O
 *   indice UNICO sobre ela garante no banco no maximo UMA solicitacao pendente
 *   por usuario e canal - dois administradores iniciando ao mesmo tempo nao
 *   criam duas. MySQL e Oracle aceitam varios nulos num indice unico, entao as
 *   solicitacoes encerradas nao colidem. (Indice parcial nao existe nos dois
 *   bancos; esta coluna o substitui de forma portavel.)
 *
 * `usuario_id` e `criado_por_id` sem chave estrangeira, como as demais
 * referencias a usuario. Nomes curtos pelo limite do Oracle (ADR 0001).
 */
@Entity({ name: 'identity_link_requests' })
export class IdentityLinkRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'canal', type: 'varchar', length: IDENTITY_CHANNEL_MAX_LENGTH })
  canal: IdentityChannel;

  /** Usuario interno que recebera o vinculo. Indexado para a listagem por usuario. */
  @Index('ix_link_req_usuario')
  @Column({ name: 'usuario_id', type: 'varchar', length: 36 })
  usuarioId: string;

  @Index('ux_link_req_codigo', { unique: true })
  @Column({ name: 'codigo_hash', type: 'varchar', length: 64 })
  codigoHash: string;

  @Column({ name: 'status', type: 'varchar', length: 12 })
  status: LinkRequestStatus;

  @Index('ux_link_req_pendente', { unique: true })
  @Column({ name: 'pendente_chave', type: 'varchar', length: 60, nullable: true })
  pendenteChave: string | null;

  /** `type: Date` com precisao 6: o mesmo tipo de `created_at` em cada driver. */
  @Column({ name: 'expira_em', type: Date, precision: 6 })
  expiraEm: Date;

  /** Quem iniciou a solicitacao: sempre o usuario autenticado da API. */
  @Column({ name: 'criado_por_id', type: 'varchar', length: 36 })
  criadoPorId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** Valor de `pendente_chave` de uma solicitacao pendente. */
export function pendingKey(usuarioId: string, canal: IdentityChannel): string {
  return `${usuarioId}:${canal}`;
}
