import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { NfseEmissionInput } from './nfse-dps';

/**
 * Maquina de estados de UMA emissao. Transicoes (todas condicionais no banco, nunca "ler e gravar"):
 *
 *   AGUARDANDO_CONFIRMACAO -> ENVIANDO        (confirmacao consumida UMA vez)
 *   AGUARDANDO_CONFIRMACAO -> EXPIRADA        (prazo vencido ou substituida por outro pedido)
 *   ENVIANDO -> AUTORIZADA | REJEITADA | NAO_ENVIADA | INCERTA
 *   INCERTA  -> AUTORIZADA                    (so por CONSULTA a Sefin; nunca por reenvio)
 *
 * `INCERTA` e o estado do medo: nao se sabe se a nota existe. Ele nao sai por reenvio nem por
 * decisao automatica; a reconciliacao e por consulta (`/nfse_status`) ou, no limite, no portal.
 */
export enum NfseEmissionStatus {
  AguardandoConfirmacao = 'AGUARDANDO_CONFIRMACAO',
  Expirada = 'EXPIRADA',
  Enviando = 'ENVIANDO',
  Autorizada = 'AUTORIZADA',
  Rejeitada = 'REJEITADA',
  NaoEnviada = 'NAO_ENVIADA',
  Incerta = 'INCERTA',
}

@Entity({ name: 'nfse_emissions' })
@Index('ux_nfse_dps_id', ['ambiente', 'dpsId'], { unique: true })
@Index('ux_nfse_numero', ['ambiente', 'serie', 'numeroDps'], { unique: true })
@Index('ux_nfse_confirm', ['confirmHash'], { unique: true })
@Index('ux_nfse_chave', ['chaveAcesso'], { unique: true })
@Index('ix_nfse_usuario', ['usuarioId', 'createdAt'])
export class NfseEmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'varchar', length: 36 })
  usuarioId: string;

  /** Canal onde o pedido nasceu: a confirmacao so vale NELE. */
  @Column({ name: 'canal', type: 'varchar', length: 20 })
  canal: string;

  @Column({ name: 'status', type: 'varchar', length: 30 })
  status: NfseEmissionStatus;

  /** `tpAmb`: 1 producao, 2 homologacao. */
  @Column({ name: 'ambiente', type: 'int' })
  ambiente: number;

  @Column({ name: 'serie', type: 'varchar', length: 5 })
  serie: string;

  @Column({ name: 'numero_dps', type: 'int' })
  numeroDps: number;

  /**
   * `Id` da DPS: identifica a DPS na Sefin (reenviar a mesma DPS nao gera segunda nota). O `Id` NAO
   * traz o ambiente: homologacao e producao podem repetir o mesmo `Id`, por isso o unico e por ambiente.
   */
  @Column({ name: 'dps_id', type: 'varchar', length: 45 })
  dpsId: string;

  /** Entrada fiscal (JSON). Dado pessoal do tomador: nunca vai a log, auditoria ou resposta de chat. */
  @Column({ name: 'dados', type: 'simple-json' })
  dados: NfseEmissionInput;

  /** SHA-256 do resumo mostrado a quem confirma: o que foi confirmado e o que foi mostrado. */
  @Column({ name: 'resumo_hash', type: 'varchar', length: 64 })
  resumoHash: string;

  /** SHA-256 do codigo de confirmacao (o codigo em si nunca e gravado). `null` apos consumido. */
  @Column({ name: 'confirm_hash', type: 'varchar', length: 64, nullable: true })
  confirmHash: string | null;

  @Column({ name: 'confirm_expires_at', type: Date, precision: 6, nullable: true })
  confirmExpiresAt: Date | null;

  @Column({ name: 'confirmado_em', type: Date, precision: 6, nullable: true })
  confirmadoEm: Date | null;

  @Column({ name: 'tentativas', type: 'int', default: 0 })
  tentativas: number;

  @Column({ name: 'ultima_tentativa_em', type: Date, precision: 6, nullable: true })
  ultimaTentativaEm: Date | null;

  @Column({ name: 'chave_acesso', type: 'varchar', length: 50, nullable: true })
  chaveAcesso: string | null;

  /** XML da NFS-e autorizada: armazenamento privado, sem rota que o devolva sem permissao. */
  @Column({ name: 'nfse_xml', type: 'simple-json', nullable: true })
  nfseXml: string | null;

  /** Codigo oficial (`E####`) ou motivo interno em vocabulario fechado. */
  @Column({ name: 'erro_codigo', type: 'varchar', length: 40, nullable: true })
  erroCodigo: string | null;

  @Column({ name: 'erro_mensagem', type: 'varchar', length: 300, nullable: true })
  erroMensagem: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
