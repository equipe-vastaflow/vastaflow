import { ConflictException, Injectable } from '@nestjs/common';
import type { RoleName } from '../roles/role-name.enum';
import { RolesService } from '../roles/roles.service';
import type { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { DuplicateEmailError, UsersRepository } from './users.repository';

export interface CreateUserInput {
  nome: string;
  email: string;
  /** Senha em texto puro; e transformada em hash antes de ser persistida. */
  senha: string;
  role: RoleName;
}

export interface UserCounts {
  total: number;
  ativos: number;
  inativos: number;
}

const DEFAULT_LIST_LIMIT = 100;

/** E-mail e case-insensitive na pratica; guardamos sempre em minusculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly rolesService: RolesService,
    private readonly passwordService: PasswordService,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findById(id);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(normalizeEmail(email));
  }

  findAll(limit: number = DEFAULT_LIST_LIMIT): Promise<User[]> {
    return this.usersRepository.findAll(limit);
  }

  /** Quantidade de usuarios por status, sem carregar nenhuma linha. */
  async countByStatus(): Promise<UserCounts> {
    const { total, ativos } = await this.usersRepository.countByStatus();
    return { total, ativos, inativos: total - ativos };
  }

  /** Nome dos usuarios informados, numa consulta so. Ids desconhecidos ficam de fora. */
  findNamesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    return this.usersRepository.findNamesByIds(ids);
  }

  /**
   * Cria um usuario ativo com o perfil informado.
   *
   * @throws ConflictException quando o e-mail ja esta cadastrado.
   */
  async create(input: CreateUserInput): Promise<User> {
    const email = normalizeEmail(input.email);

    // A checagem previa da a mensagem amigavel no caso comum; a restricao de
    // unicidade do banco (tratada abaixo) cobre a corrida entre dois cadastros.
    if (await this.usersRepository.findByEmail(email)) {
      throw new ConflictException('E-mail ja cadastrado');
    }

    const [role, senhaHash] = await Promise.all([
      this.rolesService.getByName(input.role),
      this.passwordService.hash(input.senha),
    ]);

    try {
      return await this.usersRepository.create({
        nome: input.nome.trim(),
        email,
        senhaHash,
        role,
      });
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        throw new ConflictException('E-mail ja cadastrado');
      }
      throw error;
    }
  }
}
