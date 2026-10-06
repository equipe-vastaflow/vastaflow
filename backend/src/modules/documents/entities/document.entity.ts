import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NAME_MAX_BYTES } from '../document-file.policy';
import { STORAGE_KEY_MAX_LENGTH } from '../storage/storage-key';
import { SIZE_PRECISION, sizeTransformer } from './size.transformer';

/** Comprimento da coluna de MIME. O mais longo em uso tem 71 caracteres. */
export const MIME_TYPE_MAX_LENGTH = 100;

/**
 * Documento armazenado pelo sistema.
 *
 * Fundacao deliberadamente pequena: nao ha versao, exclusao logica, checksum,
 * vinculo com entidade de negocio, pasta nem compartilhamento. Cada um desses
 * conceitos depende de decisao que ainda nao existe, e todos entram de forma
 * aditiva depois.
 *
 * Separa tres nomes que costumam ser confundidos:
 *
 * - `nomeOriginal`: o que o usuario enviou. Metadado, preservado como veio.
 * - `nome`: o nome logico, exibido e (numa fase futura) renomeavel.
 * - `storageKey`: a chave fisica, gerada pelo servidor. NUNCA sai na API.
 *
 * O conteudo NAO esta aqui: os bytes vivem no storage, atras da `StoragePort`.
 * Manter binario fora do banco evita o tipo com maior divergencia entre
 * `mysql2` e `oracledb` (`longblob` x `blob`, `Buffer` x `Lob`) - e o Oracle
 * nunca foi validado em instancia real.
 */
@Entity({ name: 'documents' })
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nome logico. Comeca igual ao original; renomear e fase futura. */
  @Column({ name: 'nome', type: 'varchar', length: NAME_MAX_BYTES })
  nome: string;

  /**
   * Nome como o usuario enviou, preservado inclusive com acento e espaco.
   *
   * E metadado, nunca caminho: usar nome de usuario para montar caminho fisico
   * e a origem classica de travessia de diretorio.
   */
  @Column({ name: 'nome_original', type: 'varchar', length: NAME_MAX_BYTES })
  nomeOriginal: string;

  /** MIME validado contra a extensao no upload (`document-file.policy.ts`). */
  @Column({ name: 'mime_type', type: 'varchar', length: MIME_TYPE_MAX_LENGTH })
  mimeType: string;

  /**
   * Tamanho em bytes.
   *
   * `decimal(20,0)` - inteiro exato, nao ponto flutuante, e com folga muito
   * acima dos 2 GB em que o `int` do MySQL estouraria.
   *
   * NAO e `bigint`: o driver Oracle do TypeORM recusa esse tipo ("Data type
   * bigint ... is not supported by oracle"), o que foi descoberto gerando o DDL
   * Oracle a partir desta entity. `decimal` existe nos dois bancos
   * (`decimal(20,0)` no MySQL, `number(20,0)` no Oracle) e e o mesmo tipo que o
   * financeiro ja usa com sucesso em ambos.
   *
   * O driver devolve decimal como STRING no MySQL e como number em outros - o
   * `sizeTransformer` uniformiza, mesmo motivo do `moneyTransformer`.
   */
  @Column({
    name: 'tamanho',
    type: 'decimal',
    precision: SIZE_PRECISION,
    scale: 0,
    transformer: sizeTransformer,
  })
  tamanho: number;

  /**
   * Chave fisica no storage, gerada pelo servidor (`storage-key.ts`).
   *
   * UNIQUE para que duas linhas nunca apontem para o mesmo objeto: sem isso,
   * uma remocao futura apagaria o conteudo de outro documento.
   *
   * Nao aparece em nenhum DTO de resposta - e detalhe de infraestrutura.
   */
  @Index('ux_doc_storage_key', { unique: true })
  @Column({ name: 'storage_key', type: 'varchar', length: STORAGE_KEY_MAX_LENGTH })
  storageKey: string;

  /**
   * Quem enviou o documento, sempre o usuario autenticado - nunca um id vindo
   * do cliente.
   *
   * Coluna simples, SEM chave estrangeira, seguindo o padrao do projeto
   * (`financial_entries.criado_por_id`, `audit_logs.usuario_id`): o documento
   * nao deve depender do cadastro de usuarios para continuar valido.
   *
   * E metadado de auditoria, NAO isolamento de acesso: quem tem
   * `documents:read` ve todos os documentos. Nao ha dono nem ACL nesta fase.
   */
  @Column({ name: 'criado_por_id', type: 'varchar', length: 36 })
  criadoPorId: string;

  /** Indexado porque a listagem ordena por ele. */
  @Index('ix_doc_created')
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
