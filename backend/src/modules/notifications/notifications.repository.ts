import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';

export type NewNotification = Pick<
  Notification,
  'usuarioId' | 'titulo' | 'mensagem' | 'tipo' | 'lida'
>;

/**
 * Acesso a tabela `notifications`.
 *
 * TODA consulta e filtrada por `usuarioId`: nao existe metodo que leia ou
 * altere notificacao sem dizer de quem ela e. O isolamento entre usuarios
 * comeca aqui, e nao so na camada de servico.
 *
 * `lida` nunca vai como parametro booleano: o literal `= 0` vale nos tres
 * drivers (tinyint no MySQL, NUMBER no Oracle, integer no SQLite dos testes),
 * enquanto a conversao de um parametro booleano varia entre eles - mesmo
 * cuidado ja aplicado em `UsersRepository.countByStatus`.
 */
@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  /** A notificacao, somente se pertencer a este usuario. */
  findByIdForUser(id: string, usuarioId: string): Promise<Notification | null> {
    return this.repository.findOne({ where: { id, usuarioId } });
  }

  /**
   * Pagina de notificacoes do usuario: nao lidas primeiro, depois das mais
   * recentes para as mais antigas.
   *
   * `lida` ascendente coloca as nao lidas na frente porque `false` grava 0 e
   * `true` grava 1 em todos os bancos. O `id` desempata: varias notificacoes
   * podem cair no mesmo instante, e sem criterio estavel a mesma linha poderia
   * aparecer em duas paginas - ou em nenhuma. Mesmo cuidado da auditoria e do
   * financeiro.
   *
   * Uma unica consulta traz as linhas e o total (`findAndCount`).
   */
  findPageForUser(
    usuarioId: string,
    skip: number,
    take: number,
  ): Promise<[Notification[], number]> {
    return this.repository.findAndCount({
      where: { usuarioId },
      order: { lida: 'ASC', createdAt: 'DESC', id: 'DESC' },
      skip,
      take,
    });
  }

  /** `COUNT` no banco, servido pelo prefixo de `ix_notif_dest`: nenhuma linha e carregada. */
  countUnreadForUser(usuarioId: string): Promise<number> {
    return this.repository
      .createQueryBuilder('n')
      .where('n.usuario_id = :usuarioId', { usuarioId })
      .andWhere('n.lida = 0')
      .getCount();
  }

  create(data: NewNotification): Promise<Notification> {
    return this.repository.save(this.repository.create(data));
  }

  save(notification: Notification): Promise<Notification> {
    return this.repository.save(notification);
  }

  /**
   * Marca como lidas, em UM comando, todas as nao lidas do usuario.
   *
   * `lida` recebe o literal `1` e `updated_at` recebe a data explicitamente: um
   * `UPDATE` por query builder nao dispara o `@UpdateDateColumn`, e o
   * `ON UPDATE CURRENT_TIMESTAMP` existe no MySQL mas nao no Oracle.
   */
  async markAllAsReadForUser(usuarioId: string, quando: Date): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(Notification)
      .set({ lida: () => '1', updatedAt: quando })
      .where('usuario_id = :usuarioId', { usuarioId })
      .andWhere('lida = 0')
      .execute();
  }
}
