import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import type { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import { User } from './entities/user.entity';

/** Violacao da unicidade de e-mail, traduzida do erro especifico de cada banco. */
export class DuplicateEmailError extends Error {
  constructor() {
    super('E-mail ja cadastrado');
    this.name = 'DuplicateEmailError';
  }
}

export interface NewUser {
  nome: string;
  email: string;
  senhaHash: string;
  role: Role;
}

/**
 * Campos cadastrais que a edicao administrativa (`PATCH /users/:id`) alcanca.
 *
 * O tipo e a primeira barreira - so estes dois campos existem nele; a segunda
 * e a lista branca dentro de `updateFields`, que vale mesmo contra um cast.
 */
export type EditableUserFields = Partial<Pick<User, 'nome' | 'email'>>;

const WITH_ROLE = { role: { permissions: true } } as const;

/** Drivers em que `SELECT ... FOR UPDATE` existe. O SQLite dos testes ja serializa as escritas. */
const ROW_LOCK_DRIVERS = new Set(['mysql', 'mariadb', 'oracle']);

/**
 * Visao do banco dentro de `UsersRepository.runLockedAdminChange`: o alvo e os
 * ADMINs foram lidos com as linhas travadas ate o fim da transacao.
 */
export interface LockedAdminChange {
  /** `null` quando o usuario nao existe. */
  target: User | null;
  /** Quantos ADMINs ativos existem agora, contando o alvo se ele for um. */
  activeAdminCount: number;
  save(user: User): Promise<User>;
}

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id }, relations: WITH_ROLE });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email }, relations: WITH_ROLE });
  }

  findAll(limit: number): Promise<User[]> {
    return this.repository.find({ relations: WITH_ROLE, order: { nome: 'ASC' }, take: limit });
  }

  /**
   * Contagem de usuarios por status, em UMA consulta agregada.
   *
   * Nenhuma linha e carregada. A consulta unica tambem garante que total e
   * ativos venham do mesmo instante - com dois COUNT separados, um cadastro
   * entre eles produziria `inativos` negativo.
   *
   * `ativo = 1` literal em vez de parametro booleano: o valor e 1/0 nos tres
   * drivers (tinyint no MySQL, NUMBER no Oracle, integer no SQLite dos testes)
   * e assim nao dependemos de como cada driver converte um parametro booleano.
   */
  async countByStatus(): Promise<{ total: number; ativos: number }> {
    const raw = await this.repository
      .createQueryBuilder('u')
      .select('COUNT(1)', 'total')
      .addSelect('SUM(CASE WHEN u.ativo = 1 THEN 1 ELSE 0 END)', 'ativos')
      .getRawOne<Record<string, unknown>>();

    return { total: readCount(raw, 'total'), ativos: readCount(raw, 'ativos') };
  }

  /**
   * Nome dos usuarios informados, numa unica consulta (`WHERE id IN (...)`).
   *
   * Usada para dar nome aos autores dos eventos de auditoria sem uma consulta
   * por evento. Le so as colunas necessarias: sem perfil, sem permissoes e sem
   * o hash da senha.
   */
  async findNamesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.repository.find({
      where: { id: In([...new Set(ids)]) },
      select: { id: true, nome: true },
    });
    return new Map(rows.map((row) => [row.id, row.nome]));
  }

  /** Pagina ordenada por nome; o e-mail (unico) desempata e deixa a ordem estavel entre paginas. */
  findPage(skip: number, take: number): Promise<[User[], number]> {
    return this.repository.findAndCount({
      relations: WITH_ROLE,
      order: { nome: 'ASC', email: 'ASC' },
      skip,
      take,
    });
  }

  /**
   * Altera SOMENTE os campos cadastrais informados (`nome` e/ou `email`).
   *
   * Substitui o antigo `update(user)`, que fazia `save(entity)`. A troca e de
   * seguranca, nao de estilo: o `save` compara a entidade carregada com a linha
   * atual e inclui no UPDATE TODA coluna que diferir, entao uma entidade lida
   * antes de uma alteracao administrativa concorrente reescrevia `ativo`,
   * `role_id` e `senha_hash` com os valores antigos - reativando uma conta
   * recem-desativada ou devolvendo um perfil recem-revogado.
   *
   * Aqui as colunas sao citadas UMA A UMA, a partir de um objeto montado dentro
   * deste metodo: nenhuma chave extra que chegue em `changes` (nem por um cast)
   * alcanca o comando. `ativo`, `role_id`, `senha_hash`, `id` e `created_at`
   * nao tem como entrar.
   *
   * `updated_at` vai explicito porque um UPDATE por query builder nao dispara o
   * `@UpdateDateColumn`, e o `ON UPDATE CURRENT_TIMESTAMP` existe no MySQL mas
   * nao no Oracle - mesmo cuidado de `updateName` e do modulo de notificacoes.
   *
   * @returns quantas linhas foram alcancadas: zero quando o usuario nao existe mais.
   * @throws DuplicateEmailError quando o e-mail novo pertence a outro usuario.
   */
  async updateFields(id: string, changes: EditableUserFields, quando: Date): Promise<number> {
    try {
      const result = await this.repository
        .createQueryBuilder()
        .update(User)
        .set({
          // Lista branca explicita: so estas duas colunas, e so quando vieram.
          ...(changes.nome === undefined ? {} : { nome: changes.nome }),
          ...(changes.email === undefined ? {} : { email: changes.email }),
          updatedAt: quando,
        })
        .where('id = :id', { id })
        .execute();

      return result.affected ?? 0;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  /**
   * Altera SOMENTE a coluna `nome`, direto no banco.
   *
   * Existe para o `PATCH /profile`, e nao usa `save(entity)` de proposito. O
   * `save` compara a entidade em memoria com a linha atual e inclui no UPDATE
   * TODA coluna que diferir - entao uma entidade carregada antes de uma
   * alteracao administrativa concorrente reescreveria `ativo`, `role_id`,
   * `senha_hash` e `email` com os valores antigos. Aqui o UPDATE cita apenas
   * `nome` e `updated_at`: nenhuma coluna administrativa entra no comando, e
   * uma alteracao concorrente sobrevive.
   *
   * `updated_at` vai explicito porque um UPDATE por query builder nao dispara
   * o `@UpdateDateColumn`, e o `ON UPDATE CURRENT_TIMESTAMP` existe no MySQL
   * mas nao no Oracle - mesmo cuidado de `NotificationsRepository`.
   *
   * @returns quantas linhas foram alcancadas: zero quando o usuario nao existe mais.
   */
  async updateName(id: string, nome: string, quando: Date): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(User)
      .set({ nome, updatedAt: quando })
      .where('id = :id', { id })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Executa uma alteracao de status ou de perfil sob lock, para que a regra do
   * "ultimo ADMIN ativo" valha tambem sob concorrencia.
   *
   * Sem o lock, dois ADMINs desativando um ao outro ao mesmo tempo passariam os
   * dois pela checagem (cada um ve 2 ADMINs ativos) e o sistema ficaria sem
   * nenhum. Aqui as linhas dos ADMINs e do alvo ficam travadas (`FOR UPDATE`)
   * ate o commit: a segunda transacao espera a primeira e entao le o estado
   * ja atualizado.
   *
   * O lock vem ANTES de qualquer leitura comum: no MySQL (REPEATABLE READ) a
   * foto da transacao so e tirada na primeira leitura sem lock, que assim ja
   * enxerga o que a transacao concorrente gravou.
   */
  runLockedAdminChange<T>(
    targetId: string,
    work: (change: LockedAdminChange) => Promise<T>,
  ): Promise<T> {
    return this.repository.manager.transaction(async (manager) => {
      await lockAdminsAndTarget(manager, targetId);

      // Leituras sequenciais: dentro da transacao todas usam a mesma conexao.
      const repository = manager.getRepository(User);
      const target = await repository.findOne({ where: { id: targetId }, relations: WITH_ROLE });
      // Filtra `ativo` em memoria: evita depender de como cada driver converte
      // o booleano num parametro (NUMBER 1/0 no Oracle). Sao poucos ADMINs.
      const admins = await repository.find({
        where: { role: { nome: RoleName.Admin } },
        relations: { role: true },
      });

      return work({
        target,
        activeAdminCount: admins.filter((admin) => admin.ativo).length,
        save: (user) => saveTranslatingDuplicates(repository, user),
      });
    });
  }

  async create(data: NewUser): Promise<User> {
    try {
      // `role` ja vem carregado (com permissoes) em `data`, entao a entidade
      // devolvida esta completa e dispensa uma nova consulta.
      return await this.repository.save(this.repository.create({ ...data, ativo: true }));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  save(user: User): Promise<User> {
    return this.repository.save(user);
  }
}

/**
 * Le um valor agregado do resultado cru.
 *
 * Dois cuidados de portabilidade: o MySQL devolve `SUM` como string (decimal) e
 * o Oracle devolve o alias em maiusculas quando ele nao chega citado. `SUM` de
 * tabela vazia e NULL, que vira 0.
 */
function readCount(raw: Record<string, unknown> | null | undefined, alias: string): number {
  const value = raw?.[alias] ?? raw?.[alias.toUpperCase()];
  return value === null || value === undefined ? 0 : Number(value);
}

async function saveTranslatingDuplicates(repository: Repository<User>, user: User): Promise<User> {
  try {
    return await repository.save(user);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateEmailError();
    }
    throw error;
  }
}

/**
 * Trava as linhas dos ADMINs e do alvo. Seleciona so o id e nao usa LIMIT: o
 * Oracle recusa `FOR UPDATE` junto de `FETCH FIRST` (ORA-02014).
 */
async function lockAdminsAndTarget(manager: EntityManager, targetId: string): Promise<void> {
  if (!ROW_LOCK_DRIVERS.has(manager.connection.options.type)) {
    return;
  }
  await manager
    .getRepository(User)
    .createQueryBuilder('u')
    .innerJoin('u.role', 'r')
    .select('u.id', 'id')
    .where('r.nome = :admin OR u.id = :targetId', { admin: RoleName.Admin, targetId })
    .setLock('pessimistic_write')
    .getRawMany();
}

/**
 * A unicidade so pode ser violada pelo e-mail (unica coluna unica alem do id
 * gerado). Cada banco sinaliza de um jeito: MySQL `ER_DUP_ENTRY`/1062, Oracle
 * `ORA-00001`, SQLite `UNIQUE constraint failed` (usado nos testes).
 */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: unknown; errno?: unknown } | undefined;
  if (driverError?.code === 'ER_DUP_ENTRY' || driverError?.errno === 1062) {
    return true;
  }
  return /UNIQUE constraint failed|ORA-00001/i.test(error.message);
}
