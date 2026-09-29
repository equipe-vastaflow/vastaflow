import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Notification } from './entities/notification.entity';
import { NotificationType } from './notification.enums';
import type { NewNotificationInput } from './notification.policy';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

const DONO = 'user-1';
const OUTRO = 'user-2';

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    usuarioId: DONO,
    titulo: 'Lancamento aprovado',
    mensagem: 'O lancamento de manutencao foi marcado como pago.',
    tipo: NotificationType.Success,
    lida: false,
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
    updatedAt: new Date('2026-09-24T10:00:00.000Z'),
    readAt: null,
    ...overrides,
  };
}

const NOVA: NewNotificationInput = {
  usuarioId: DONO,
  titulo: 'Titulo',
  mensagem: 'Mensagem',
  tipo: NotificationType.Info,
};

describe('NotificationsService', () => {
  let repository: jest.Mocked<
    Pick<
      NotificationsRepository,
      | 'findByIdForUser'
      | 'findPageForUser'
      | 'countUnreadForUser'
      | 'create'
      | 'markAsReadForUser'
      | 'markAllAsReadForUser'
    >
  >;
  let service: NotificationsService;

  beforeEach(() => {
    repository = {
      findByIdForUser: jest.fn().mockResolvedValue(notification()),
      findPageForUser: jest.fn().mockResolvedValue([[notification()], 1]),
      countUnreadForUser: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((data: object) => Promise.resolve(notification(data))),
      markAsReadForUser: jest.fn().mockResolvedValue(1),
      markAllAsReadForUser: jest.fn().mockResolvedValue(undefined),
    };
    service = new NotificationsService(repository as unknown as NotificationsRepository);
  });

  describe('list', () => {
    it('consulta sempre filtrando pelo usuario autenticado', async () => {
      await service.list(DONO, 1, 20);

      expect(repository.findPageForUser).toHaveBeenCalledWith(DONO, 0, 20);
    });

    it('converte pagina e limite em skip e take', async () => {
      await service.list(DONO, 3, 15);

      expect(repository.findPageForUser).toHaveBeenCalledWith(DONO, 30, 15);
    });

    it('devolve os itens e o total vindos do banco', async () => {
      repository.findPageForUser.mockResolvedValue([[notification(), notification()], 42]);

      const { items, total } = await service.list(DONO, 1, 20);

      expect(items).toHaveLength(2);
      expect(total).toBe(42);
    });

    it('lista vazia: nenhum item e total zero', async () => {
      repository.findPageForUser.mockResolvedValue([[], 0]);

      expect(await service.list(DONO, 1, 20)).toEqual({ items: [], total: 0 });
    });

    /**
     * Uma consulta para a pagina (com o COUNT junto, via `findAndCount`) e
     * nada mais: nenhuma busca por notificacao para montar a lista.
     */
    it('nao faz uma consulta por notificacao', async () => {
      repository.findPageForUser.mockResolvedValue([
        [notification({ id: 'a' }), notification({ id: 'b' }), notification({ id: 'c' })],
        3,
      ]);

      await service.list(DONO, 1, 20);

      expect(repository.findPageForUser).toHaveBeenCalledTimes(1);
      expect(repository.findByIdForUser).not.toHaveBeenCalled();
    });
  });

  describe('countUnread', () => {
    it('usa o COUNT do banco, filtrado pelo usuario', async () => {
      repository.countUnreadForUser.mockResolvedValue(3);

      expect(await service.countUnread(DONO)).toBe(3);
      expect(repository.countUnreadForUser).toHaveBeenCalledWith(DONO);
      expect(repository.findPageForUser).not.toHaveBeenCalled();
    });

    it('sem nenhuma por ler: zero', async () => {
      expect(await service.countUnread(DONO)).toBe(0);
    });
  });

  describe('get', () => {
    it('devolve a notificacao do proprio usuario', async () => {
      expect((await service.get(DONO, 'notif-1')).id).toBe('notif-1');
      expect(repository.findByIdForUser).toHaveBeenCalledWith('notif-1', DONO);
    });

    /**
     * O repositorio filtra por dono, entao a notificacao de outra pessoa
     * simplesmente nao aparece - e o servico responde o mesmo 404 de um id
     * inexistente. De fora, os dois casos sao indistinguiveis.
     */
    it('id de outro usuario: NotFoundException, igual a id inexistente', async () => {
      repository.findByIdForUser.mockResolvedValue(null);

      await expect(service.get(OUTRO, 'notif-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.get(OUTRO, 'nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a mensagem de erro nao diz de quem era a notificacao', async () => {
      repository.findByIdForUser.mockResolvedValue(null);

      await expect(service.get(OUTRO, 'notif-1')).rejects.toThrow('Notificacao nao encontrada');
    });
  });

  /**
   * UPDATE direcionado + releitura. O `WHERE` do repositorio (dono e
   * `lida = 0`) e testado contra o banco no e2e; aqui, o que o servico pede.
   */
  describe('markAsRead', () => {
    const LIDA_EM = new Date('2026-09-25T08:00:00.000Z');

    it('grava por UPDATE direcionado, com o dono e o horario', async () => {
      await service.markAsRead(DONO, 'notif-1');

      expect(repository.markAsReadForUser).toHaveBeenCalledTimes(1);
      expect(repository.markAsReadForUser).toHaveBeenCalledWith('notif-1', DONO, expect.any(Date));
    });

    it('devolve o estado relido do banco, com readAt preenchido', async () => {
      repository.findByIdForUser.mockResolvedValue(notification({ lida: true, readAt: LIDA_EM }));

      const lida = await service.markAsRead(DONO, 'notif-1');

      expect(lida.lida).toBe(true);
      expect(lida.readAt).toBe(LIDA_EM);
      // A releitura acontece DEPOIS do UPDATE, e tambem filtrada pelo dono.
      expect(repository.findByIdForUser).toHaveBeenCalledWith('notif-1', DONO);
      expect(repository.markAsReadForUser.mock.invocationCallOrder[0]).toBeLessThan(
        repository.findByIdForUser.mock.invocationCallOrder[0],
      );
    });

    it('ja lida: o UPDATE nao alcanca nada e o readAt original volta intacto', async () => {
      repository.markAsReadForUser.mockResolvedValue(0);
      repository.findByIdForUser.mockResolvedValue(notification({ lida: true, readAt: LIDA_EM }));

      const resultado = await service.markAsRead(DONO, 'notif-1');

      expect(resultado.lida).toBe(true);
      expect(resultado.readAt).toBe(LIDA_EM);
    });

    it('notificacao de outro usuario: 404, e o UPDATE levou o dono verdadeiro', async () => {
      repository.markAsReadForUser.mockResolvedValue(0);
      repository.findByIdForUser.mockResolvedValue(null);

      await expect(service.markAsRead(OUTRO, 'notif-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.markAsReadForUser).toHaveBeenCalledWith('notif-1', OUTRO, expect.any(Date));
    });

    it('id inexistente: 404', async () => {
      repository.markAsReadForUser.mockResolvedValue(0);
      repository.findByIdForUser.mockResolvedValue(null);

      await expect(service.markAsRead(DONO, 'sumida')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('nao persiste a entidade inteira: o repositorio nem expoe mais save', () => {
      expect(Object.getOwnPropertyNames(NotificationsRepository.prototype)).not.toContain('save');
    });
  });

  describe('markAllAsRead', () => {
    it('marca as nao lidas do usuario e informa quantas eram', async () => {
      repository.countUnreadForUser.mockResolvedValue(3);

      expect(await service.markAllAsRead(DONO)).toEqual({ atualizadas: 3 });
      expect(repository.markAllAsReadForUser).toHaveBeenCalledWith(DONO, expect.any(Date));
    });

    it('sem nenhuma por ler: nao grava nada e devolve zero', async () => {
      expect(await service.markAllAsRead(DONO)).toEqual({ atualizadas: 0 });
      expect(repository.markAllAsReadForUser).not.toHaveBeenCalled();
    });

    it('repetir a operacao e seguro: a segunda vez nao grava', async () => {
      repository.countUnreadForUser.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

      expect(await service.markAllAsRead(DONO)).toEqual({ atualizadas: 2 });
      expect(await service.markAllAsRead(DONO)).toEqual({ atualizadas: 0 });
      expect(repository.markAllAsReadForUser).toHaveBeenCalledTimes(1);
    });

    it('o UPDATE leva o usuario: nunca alcanca notificacao de outra pessoa', async () => {
      repository.countUnreadForUser.mockResolvedValue(1);

      await service.markAllAsRead(DONO);

      expect(repository.countUnreadForUser).toHaveBeenCalledWith(DONO);
      expect(repository.markAllAsReadForUser).toHaveBeenCalledWith(DONO, expect.any(Date));
    });

    it('um unico comando, nao uma gravacao por notificacao', async () => {
      repository.countUnreadForUser.mockResolvedValue(50);

      await service.markAllAsRead(DONO);

      expect(repository.markAllAsReadForUser).toHaveBeenCalledTimes(1);
      expect(repository.markAsReadForUser).not.toHaveBeenCalled();
    });
  });

  describe('createForUser', () => {
    it('cria para o usuario informado, sempre por ler', async () => {
      await service.createForUser(NOVA);

      expect(repository.create).toHaveBeenCalledWith({
        usuarioId: DONO,
        titulo: 'Titulo',
        mensagem: 'Mensagem',
        tipo: NotificationType.Info,
        lida: false,
        readAt: null,
      });
    });

    it('cria para o destinatario certo, mesmo que nao seja quem disparou', async () => {
      await service.createForUser({ ...NOVA, usuarioId: OUTRO });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: OUTRO }));
    });

    it('normaliza os textos antes de gravar', async () => {
      await service.createForUser({ ...NOVA, titulo: '  Titulo  ', mensagem: '  Mensagem  ' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ titulo: 'Titulo', mensagem: 'Mensagem' }),
      );
    });

    it.each([
      ['titulo vazio', { titulo: '' }],
      ['titulo so com espacos', { titulo: '   ' }],
      ['titulo longo demais', { titulo: 'a'.repeat(121) }],
      ['mensagem vazia', { mensagem: '' }],
      ['mensagem longa demais', { mensagem: 'a'.repeat(501) }],
      ['tipo fora do enum', { tipo: 'URGENTE' as NotificationType }],
      ['destinatario vazio', { usuarioId: '' }],
    ])('recusa %s com BadRequestException, sem gravar', async (_nome, invalido) => {
      await expect(service.createForUser({ ...NOVA, ...invalido })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    /** A operacao e interna: nenhum objeto de requisicao entra aqui. */
    it('nao depende de HTTP: recebe os campos e so', () => {
      expect(NotificationsService.length).toBe(1);
      expect(service.createForUser.length).toBe(1);
    });
  });
});
