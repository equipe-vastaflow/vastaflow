import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinancialEntryStatus, FinancialEntryType } from '../financial-entry.enums';
import { MONEY_PRECISION, MONEY_SCALE, moneyTransformer } from '../money.transformer';

/**
 * Lancamento financeiro interno.
 *
 * Primeiro dominio de negocio do VastaFlow. Deliberadamente pequeno: nao ha
 * fornecedor, cliente, conta bancaria, centro de custo, parcela, recorrencia,
 * moeda nem documento fiscal. Esses conceitos entram quando houver necessidade
 * real, cada um com a sua migration.
 *
 * Nomes de tabela e coluna curtos e em `snake_case`: o limite de identificador
 * do Oracle (30 caracteres no pior caso) e o criterio (ADR 0001).
 */
@Entity({ name: 'financial_entries' })
export class FinancialEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tipo', type: 'varchar', length: 10 })
  tipo: FinancialEntryType;

  @Column({ name: 'descricao', type: 'varchar', length: 200 })
  descricao: string;

  /**
   * Sempre positivo: quem define entrada ou saida e o `tipo`.
   *
   * `DECIMAL(15,2)` nos dois bancos - dinheiro nunca em ponto flutuante. O
   * `moneyTransformer` uniformiza a leitura, que difere entre os drivers.
   */
  @Column({
    name: 'valor',
    type: 'decimal',
    precision: MONEY_PRECISION,
    scale: MONEY_SCALE,
    transformer: moneyTransformer,
  })
  valor: number;

  /**
   * Data do evento financeiro (quando ocorreu ou deve ocorrer) - nao se
   * confunde com `createdAt`, que e quando a linha foi gravada.
   *
   * `date` (sem hora), trafegada como string `YYYY-MM-DD` de ponta a ponta.
   *
   * `utc: true` NAO e detalhe: o MySQL devolve a coluna DATE como um `Date` em
   * 00:00 UTC, e sem esta opcao o TypeORM a formata no fuso LOCAL do servidor -
   * em qualquer fuso negativo (o do Brasil, por exemplo) o dia voltaria um.
   * Gravar 2026-09-23 e ler 2026-09-22 seria um erro grave num lancamento
   * financeiro. Com `utc`, a leitura usa os getters UTC e o dia se preserva.
   * A opcao nao altera o DDL.
   */
  @Index('ix_fin_data')
  @Column({ name: 'data', type: 'date', utc: true })
  data: string;

  /** Texto livre nesta primeira versao; ainda nao ha tabela de categorias. */
  @Column({ name: 'categoria', type: 'varchar', length: 60 })
  categoria: string;

  @Index('ix_fin_status')
  @Column({ name: 'status', type: 'varchar', length: 10 })
  status: FinancialEntryStatus;

  @Column({ name: 'observacao', type: 'varchar', length: 500, nullable: true })
  observacao: string | null;

  /**
   * Quem criou o lancamento, sempre o usuario autenticado - nunca um id vindo
   * do cliente.
   *
   * Coluna simples, sem chave estrangeira, pelo mesmo motivo de
   * `audit_logs.usuario_id`: o registro financeiro nao deve depender do
   * cadastro de usuarios para continuar valido. O nome de quem criou e
   * resolvido em lote pelo `UserDirectoryService`.
   */
  @Column({ name: 'criado_por_id', type: 'varchar', length: 36 })
  criadoPorId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
