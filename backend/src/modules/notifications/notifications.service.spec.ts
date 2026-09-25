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
      | 'save'
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
      save: jest.fn().mockImplementation((n: Notification) => Promise.resolve(n)),
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

  describe('markAsRead', () => {
    it('nao lida passa a lida', async () => {
      const lida = await service.markAsRead(DONO, 'notif-1');

      expect(lida.lida).toBe(true);
      expect(repository.save).toHaveBeenCalledTimes(1);
    });

    it('ja lida continua lida, sem gravar de novo', async () => {
      repository.findByIdForUser.mockResolvedValue(notification({ lida: true }));

      const resultado = await service.markAsRead(DONO, 'notif-1');

      expect(resultado.lida).toBe(true);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('repetir a operacao e seguro', async () => {
      const alvo = notification();
      repository.findByIdForUser.mockResolvedValue(alvo);

      await service.markAsRead(DONO, 'notif-1');
      await service.markAsRead(DONO, 'notif-1');

      expect(alvo.lida).toBe(true);
      // A segunda chamada ja encontra `lida` e nao grava.
      expect(repository.save).toHaveBeenCalledTimes(1);
    });

    it('notificacao de outro usuario nao pode ser alterada', async () => {
      repository.findByIdForUser.mockResolvedValue(null);

      await expect(service.markAsRead(OUTRO, 'notif-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('a busca leva o usuario junto: nunca ha leitura sem dono', async () => {
      await service.markAsRead(DONO, 'notif-1');

      expect(repository.findByIdForUser).toHaveBeenCalledWith('notif-1', DONO);
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
      expect(repository.save).not.toHaveBeenCalled();
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
