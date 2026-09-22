import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';

/** Identificacao humana de um usuario, para exibicao. */
export interface UserIdentity {
  id: string;
  nome: string;
  email: string;
}

/**
 * Consulta somente-leitura de "quem e este id".
 *
 * Existe como modulo proprio, e nao como mais um metodo do `UsersService`,
 * porque quem precisa disto e o modulo de auditoria - e `UsersModule` ja
 * importa `AuditModule` para gravar auditoria. Importar `UsersModule` de volta
 * fecharia um ciclo. Este modulo nao importa nem `UsersModule` nem
 * `AuditModule`, entao pode ser usado pelos dois sem acoplar um ao outro.
 *
 * O escopo e deliberadamente minusculo: nada de criar, alterar ou aplicar regra
 * de negocio sobre usuarios. Isso continua sendo exclusividade do `UsersModule`.
 */
@Injectable()
export class UserDirectoryService {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  /**
   * Identidade dos usuarios informados, em UMA consulta (`WHERE id IN (...)`),
   * independentemente de quantos ids forem - nunca uma consulta por id.
   *
   * Le apenas id, nome e e-mail: sem perfil, sem permissoes e sem o hash da
   * senha. Ids repetidos sao consultados uma vez so; ids desconhecidos (ex.:
   * usuario removido) simplesmente nao aparecem no resultado.
   */
  async findByIds(ids: readonly string[]): Promise<Map<string, UserIdentity>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) {
      return new Map();
    }

    const rows = await this.repository.find({
      where: { id: In(unicos) },
      select: { id: true, nome: true, email: true },
    });

    return new Map(rows.map((row) => [row.id, { id: row.id, nome: row.nome, email: row.email }]));
  }
}
