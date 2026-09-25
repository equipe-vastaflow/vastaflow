import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SETTING_VALUE_MAX_LENGTH } from '../setting-value';
import { SystemSettingType } from '../system-setting.enums';

/** Tamanho da coluna `chave`; o formato e validado em `setting-catalog.ts`. */
export const SETTING_KEY_MAX_LENGTH = 60;

/**
 * Configuracao interna do sistema.
 *
 * NAO guarda segredo de especie alguma: senha, token, API key, credencial de
 * terceiro ou certificado nao entram aqui. Nao ha coluna `secret` e nao ha
 * cifragem - qualquer um com `settings:read` le o valor em claro. Credenciais
 * continuam vindo de variavel de ambiente.
 *
 * O `valor` e sempre TEXTO: e o `tipo` que diz como interpreta-lo. Isso mantem
 * o DDL identico em MySQL e Oracle, sem depender de JSON nativo (que exigiria
 * Oracle 21c+). A conversao fica em `setting-value.ts`.
 *
 * As chaves nao sao criadas pela API: o catalogo (`setting-catalog.ts`) e a
 * fonte, e o seeder cria o que falta a cada boot. Por isso nao existe
 * `settings:create` nem `settings:delete`.
 *
 * Nomes curtos e em `snake_case` pelo limite de identificador do Oracle (ADR 0001).
 */
@Entity({ name: 'system_settings' })
export class SystemSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Identificador estavel da configuracao, ex.: `SYSTEM_NAME`. Unico. */
  @Index('ux_settings_chave', { unique: true })
  @Column({ name: 'chave', type: 'varchar', length: SETTING_KEY_MAX_LENGTH })
  chave: string;

  /** Sempre texto. Use `readSettingValue`/`serializeSettingValue` para converter. */
  @Column({ name: 'valor', type: 'varchar', length: SETTING_VALUE_MAX_LENGTH })
  valor: string;

  /** Para que serve a configuracao. Vem do catalogo; o cliente nao altera. */
  @Column({ name: 'descricao', type: 'varchar', length: 255 })
  descricao: string;

  /** Definido no catalogo e imutavel pela API: mudar o tipo invalidaria o valor. */
  @Column({ name: 'tipo', type: 'varchar', length: 10 })
  tipo: SystemSettingType;

  /**
   * Quem alterou o valor pela ultima vez, sempre o usuario autenticado - nunca
   * um id vindo do cliente. Nulo enquanto a configuracao so tem o valor padrao
   * criado pelo seeder, quando nao houve pessoa envolvida.
   *
   * Coluna simples, sem chave estrangeira, pelo mesmo motivo de
   * `audit_logs.usuario_id` e `financial_entries.criado_por_id`: a configuracao
   * nao deve depender do cadastro de usuarios para continuar valida. O nome e
   * resolvido em lote pelo `UserDirectoryService`.
   */
  @Column({ name: 'atualizado_por_id', type: 'varchar', length: 36, nullable: true })
  atualizadoPorId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
