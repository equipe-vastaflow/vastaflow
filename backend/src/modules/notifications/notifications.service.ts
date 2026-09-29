import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Notification } from './entities/notification.entity';
import { validateNotification, type NewNotificationInput } from './notification.policy';
import { NotificationsRepository } from './notifications.repository';

export interface NotificationPage {
  items: Notification[];
  total: number;
}

/** Resultado de "marcar todas como lidas". */
export interface ReadAllResult {
  /** Quantas estavam nao lidas e passaram a lidas. Zero quando nao havia nenhuma. */
  atualizadas: number;
}

/**
 * Notificacoes internas de um usuario.
 *
 * TODO metodo publico recebe `usuarioId` como primeiro argumento, e ele vem
 * SEMPRE do usuario autenticado (`@CurrentUser()`), nunca do corpo ou da query.
 * Nao existe caminho, nesta classe, que leia ou altere a notificacao de outra
 * pessoa: o filtro por dono esta em cada consulta do repositorio.
 *
 * Consultar notificacao alheia responde 404, e nao 403: um 403 confirmaria que
 * aquele id existe. Do lado de fora, id inexistente e id de outra pessoa sao
 * indistinguiveis.
 *
 * AUDITORIA: este modulo NAO grava na trilha, de proposito.
 *
 * - consultas nunca sao auditadas neste projeto (mesmo criterio que tirou o
 *   `FINANCE_QUERIED` do financeiro);
 * - marcar como lida e estado de leitura do proprio dono, sem efeito sobre
 *   dado de negocio, dinheiro, acesso ou configuracao. Auditar isso encheria a
 *   trilha de um evento por usuario e por notificacao, justamente o ruido que
 *   dificultaria achar o que importa;
 * - a CRIACAO tambem nao e auditada aqui: quem cria uma notificacao e um modulo
 *   de negocio, que ja registra o SEU evento na trilha (o pagamento, a mudanca
 *   de perfil). Um segundo registro descreveria o aviso, nao o fato.
 *
 * Nenhuma acao de auditoria nova foi criada. Se a politica da empresa exigir
 * rastrear a leitura, o ponto de mudanca e `markAsRead`/`markAllAsRead` - o
 * `AuditService` ja esta disponivel pelo `AuditModule`, sem mecanismo paralelo.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  /** Pagina de notificacoes do usuario: nao lidas primeiro, depois as mais recentes. */
  async list(usuarioId: string, page: number, limit: number): Promise<NotificationPage> {
    const [items, total] = await this.repository.findPageForUser(
      usuarioId,
      (page - 1) * limit,
      limit,
    );
    return { items, total };
  }

  /** Quantas notificacoes do usuario estao por ler. `COUNT` no banco. */
  countUnread(usuarioId: string): Promise<number> {
    return this.repository.countUnreadForUser(usuarioId);
  }

  /** @throws NotFoundException id inexistente OU pertencente a outro usuario. */
  async get(usuarioId: string, id: string): Promise<Notification> {
    const notification = await this.repository.findByIdForUser(id, usuarioId);
    if (!notification) {
      throw new NotFoundException('Notificacao nao encontrada');
    }
    return notification;
  }

  /**
   * Marca uma notificacao do usuario como lida.
   *
   * UPDATE direcionado primeiro, releitura depois - sem find -> mutate -> save.
   * O `UPDATE` so alcanca a linha se ela for do usuario E ainda estiver por
   * ler; a releitura, tambem filtrada pelo dono, devolve o estado real.
   *
   * Idempotente: ja lida, o `UPDATE` nao alcanca nada e a resposta traz o
   * `readAt` da primeira leitura, intacto - mesmo sob requisicoes simultaneas.
   * Id inexistente e id de outra pessoa tambem nao alcancam nada, e a releitura
   * responde 404 nos dois casos, indistinguiveis.
   *
   * @throws NotFoundException id inexistente OU de outro usuario.
   */
  async markAsRead(usuarioId: string, id: string): Promise<Notification> {
    await this.repository.markAsReadForUser(id, usuarioId, new Date());
    return this.get(usuarioId, id);
  }

  /**
   * Marca como lidas todas as nao lidas do usuario, em um unico `UPDATE`.
   *
   * Idempotente: sem nenhuma por ler, nao executa escrita alguma e devolve
   * zero. Nunca alcanca notificacao de outro usuario - o `WHERE` filtra pelo
   * dono.
   *
   * A contagem vem de um `COUNT` feito antes do `UPDATE`, e nao do numero de
   * linhas afetadas, que nem todo driver informa de forma confiavel. Ela e
   * informativa: o que importa e que, depois desta chamada, o usuario nao tem
   * nenhuma nao lida.
   */
  async markAllAsRead(usuarioId: string): Promise<ReadAllResult> {
    const atualizadas = await this.repository.countUnreadForUser(usuarioId);
    if (atualizadas === 0) {
      return { atualizadas: 0 };
    }

    await this.repository.markAllAsReadForUser(usuarioId, new Date());
    return { atualizadas };
  }

  /**
   * Cria uma notificacao para um usuario. **Operacao interna.**
   *
   * Nao ha rota HTTP que chegue aqui: o usuario nao cria notificacao, nem para
   * si nem para ninguem. E o ponto de entrada para os modulos de negocio
   * avisarem alguem - nenhum disparador existe ainda, e nenhum foi inventado
   * para esta etapa.
   *
   * O destinatario e informado explicitamente por quem chama, que e codigo do
   * proprio sistema. O conteudo e validado e normalizado aqui, porque esta
   * chamada nao passa pelo `ValidationPipe` global.
   *
   * @throws BadRequestException conteudo invalido (titulo, mensagem ou tipo).
   */
  async createForUser(input: NewNotificationInput): Promise<Notification> {
    const validado = validateNotification(input);
    if (!validado.ok) {
      // `async` para que a recusa chegue como promessa rejeitada, e nao como
      // excecao sincrona: quem chama trata os dois casos no mesmo `await`.
      throw new BadRequestException(`Notificacao invalida: ${validado.erro}`);
    }

    return this.repository.create({ ...validado.value, lida: false, readAt: null });
  }
}
