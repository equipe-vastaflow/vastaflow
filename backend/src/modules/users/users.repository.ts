import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { Role } from '../roles/entities/role.entity';
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

const WITH_ROLE = { role: { permissions: true } } as const;

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
