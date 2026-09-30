import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExternalIdentityLink } from './entities/external-identity-link.entity';
import type { IdentityChannel } from './external-identity.enums';

/**
 * A identidade externa ja pertence a algum usuario (indice `ux_ext_ident_canal_id`).
 * Lancada dentro da transacao de confirmacao para desfaze-la.
 */
export class DuplicateExternalIdentityError extends Error {
  constructor() {
    super('Identidade externa ja vinculada');
    this.name = 'DuplicateExternalIdentityError';
  }
}

/** Acesso a tabela `external_identity_links`. */
@Injectable()
export class ExternalIdentitiesRepository {
  constructor(
    @InjectRepository(ExternalIdentityLink)
    private readonly repository: Repository<ExternalIdentityLink>,
  ) {}

  /** Busca do resolvedor, servida pelo indice unico `(canal, id_externo)`. */
  findByIdentity(canal: string, idExterno: string): Promise<ExternalIdentityLink | null> {
    return this.repository.findOne({ where: { canal: canal as IdentityChannel, idExterno } });
  }

  /** Vinculos de um usuario, do mais antigo para o mais recente. */
  findByUser(usuarioId: string): Promise<ExternalIdentityLink[]> {
    return this.repository.find({
      where: { usuarioId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /** O vinculo, somente se pertencer a este usuario. */
  findByIdForUser(id: string, usuarioId: string): Promise<ExternalIdentityLink | null> {
    return this.repository.findOne({ where: { id, usuarioId } });
  }

  /**
   * Remove o vinculo, somente se pertencer a este usuario - DELETE direcionado,
   * com o dono no `WHERE`.
   *
   * @returns quantas linhas foram removidas: zero quando o vinculo nao existe
   *   mais (outra remocao chegou antes) ou e de outro usuario.
   */
  async deleteForUser(id: string, usuarioId: string): Promise<number> {
    const result = await this.repository.delete({ id, usuarioId });
    return result.affected ?? 0;
  }
}
