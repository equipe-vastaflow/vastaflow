import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../database/unique-violation';
import { ExternalIdentityLink } from './entities/external-identity-link.entity';
import { IdentityLinkRequest, pendingKey } from './entities/identity-link-request.entity';
import { DuplicateExternalIdentityError } from './external-identities.repository';
import { type IdentityChannel, LinkRequestStatus } from './external-identity.enums';

/** Ja ha uma solicitacao pendente para o usuario e canal (`ux_link_req_pendente`). */
export class DuplicatePendingRequestError extends Error {
  constructor() {
    super('Ja existe solicitacao pendente');
    this.name = 'DuplicatePendingRequestError';
  }
}

export interface NewLinkRequest {
  canal: IdentityChannel;
  usuarioId: string;
  codigoHash: string;
  expiraEm: Date;
  criadoPorId: string;
}

/** Resultado da confirmacao, decidido dentro da transacao. */
export type ConfirmResult =
  | { kind: 'confirmed'; link: ExternalIdentityLink }
  /** Outra confirmacao consumiu a solicitacao antes (ou ela foi cancelada). */
  | { kind: 'not-pending' }
  /** A conta externa ja tem vinculo ativo. Nada foi alterado. */
  | { kind: 'identity-taken' };

/** Acesso a tabela `identity_link_requests`. */
@Injectable()
export class IdentityLinkRequestsRepository {
  constructor(
    @InjectRepository(IdentityLinkRequest)
    private readonly repository: Repository<IdentityLinkRequest>,
  ) {}

  /** A pendente do usuario no canal - no maximo uma, pelo indice unico. */
  findPending(usuarioId: string, canal: IdentityChannel): Promise<IdentityLinkRequest | null> {
    return this.repository.findOne({ where: { pendenteChave: pendingKey(usuarioId, canal) } });
  }

  /** Pendentes do usuario (todas as que ainda nao foram encerradas). */
  findPendingByUser(usuarioId: string): Promise<IdentityLinkRequest[]> {
    return this.repository.find({
      where: { usuarioId, status: LinkRequestStatus.Pendente },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /** Busca pelo hash do codigo, servida pelo indice unico `ux_link_req_codigo`. */
  findByCodeHash(codigoHash: string): Promise<IdentityLinkRequest | null> {
    return this.repository.findOne({ where: { codigoHash } });
  }

  /**
   * INSERT da solicitacao PENDENTE. A unicidade da pendente por usuario e canal
   * e garantida pelo indice, nao pela checagem previa do service.
   *
   * @throws DuplicatePendingRequestError ja ha pendente (inclusive sob corrida).
   */
  async create(data: NewLinkRequest): Promise<IdentityLinkRequest> {
    try {
      return await this.repository.save(
        this.repository.create({
          ...data,
          status: LinkRequestStatus.Pendente,
          pendenteChave: pendingKey(data.usuarioId, data.canal),
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicatePendingRequestError();
      }
      throw error;
    }
  }

  /**
   * Encerra uma PENDENTE, liberando `pendente_chave`. UPDATE direcionado com o
   * estado no `WHERE`: so muda quem ainda esta pendente, e so se for do usuario.
   *
   * @returns linhas alteradas (0 = nao existe, nao e do usuario ou ja encerrada).
   */
  async close(
    id: string,
    usuarioId: string,
    status: LinkRequestStatus.Cancelada | LinkRequestStatus.Expirada,
  ): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(IdentityLinkRequest)
      .set({ status, pendenteChave: null, updatedAt: new Date() })
      .where('id = :id', { id })
      .andWhere('usuario_id = :usuarioId', { usuarioId })
      .andWhere('status = :pendente', { pendente: LinkRequestStatus.Pendente })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Confirma a solicitacao e cria o vinculo ativo, numa UNICA transacao:
   *
   * 1. UPDATE ... `WHERE id = ? AND status = 'PENDENTE'` - so uma confirmacao
   *    consegue "tomar" a solicitacao. A segunda, simultanea, espera o lock da
   *    linha e depois nao a alcanca mais (0 linhas);
   * 2. INSERT do vinculo. Se a conta externa ja tiver vinculo, o indice unico
   *    `ux_ext_ident_canal_id` recusa - e a transacao inteira e desfeita: a
   *    solicitacao volta a ficar pendente e nada muda.
   *
   * O banco e a garantia final nos dois passos; nao ha SELECT decidindo nada.
   */
  confirmAndLink(request: IdentityLinkRequest, idExterno: string): Promise<ConfirmResult> {
    return this.repository.manager
      .transaction(async (manager): Promise<ConfirmResult> => {
        const claimed = await manager
          .createQueryBuilder()
          .update(IdentityLinkRequest)
          .set({ status: LinkRequestStatus.Confirmada, pendenteChave: null, updatedAt: new Date() })
          .where('id = :id', { id: request.id })
          .andWhere('status = :pendente', { pendente: LinkRequestStatus.Pendente })
          .execute();
        if ((claimed.affected ?? 0) === 0) {
          return { kind: 'not-pending' };
        }

        const links = manager.getRepository(ExternalIdentityLink);
        try {
          const link = await links.save(
            links.create({ canal: request.canal, idExterno, usuarioId: request.usuarioId }),
          );
          return { kind: 'confirmed', link };
        } catch (error) {
          if (isUniqueViolation(error)) {
            // Lancar desfaz a transacao (inclusive o passo 1).
            throw new DuplicateExternalIdentityError();
          }
          throw error;
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DuplicateExternalIdentityError) {
          return { kind: 'identity-taken' };
        }
        throw error;
      });
  }
}
