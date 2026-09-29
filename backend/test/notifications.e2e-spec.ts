import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { NotificationPageResponseDto } from '../src/modules/notifications/dto/notification-page-response.dto';
import type { NotificationResponseDto } from '../src/modules/notifications/dto/notification-response.dto';
import type { ReadAllResponseDto } from '../src/modules/notifications/dto/read-all-response.dto';
import type { UnreadCountResponseDto } from '../src/modules/notifications/dto/unread-count-response.dto';
import { Notification } from '../src/modules/notifications/entities/notification.entity';
import { NotificationType } from '../src/modules/notifications/notification.enums';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const VALID_PASSWORD = 'Senha1234';

interface Pessoa {
  id: string;
  token: string;
}

describe('Notificacoes (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let notificationsService: NotificationsService;
  let dataSource: DataSource;
  /** Dono das notificacoes usadas na maioria dos testes. */
  let ana: Pessoa;
  /** Outra pessoa: nunca pode alcancar nada da Ana. */
  let bruno: Pessoa;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;
  const uniqueEmail = (prefix: string): string => `${prefix}${++counter}@vasta.test`;

  async function criarPessoa(prefix: string, role = RoleName.Usuario): Promise<Pessoa> {
    const email = uniqueEmail(prefix);
    const user = await usersService.create({
      nome: `Teste ${prefix}`,
      email,
      senha: VALID_PASSWORD,
      role,
    });
    const login = await request(server())
      .post('/auth/login')
      .send({ email, senha: VALID_PASSWORD })
      .expect(200);
    return { id: user.id, token: (login.body as AuthResponseDto).accessToken };
  }

  /** Cria pela operacao interna - nao existe rota para o usuario criar notificacao. */
  async function notificar(
    dono: Pessoa,
    overrides: { titulo?: string; mensagem?: string; tipo?: NotificationType } = {},
  ): Promise<string> {
    const criada = await notificationsService.createForUser({
      usuarioId: dono.id,
      titulo: overrides.titulo ?? 'Aviso de teste',
      mensagem: overrides.mensagem ?? 'Conteudo do aviso de teste.',
      tipo: overrides.tipo ?? NotificationType.Info,
    });
    return criada.id;
  }

  /**
   * Cria a notificacao e fixa o `created_at`.
   *
   * Criadas em sequencia, varias caem no MESMO instante (o SQLite dos testes
   * guarda milissegundos), e ai quem decide a ordem e o desempate por `id` -
   * um UUID aleatorio. Para testar ORDENACAO e preciso que os instantes sejam
   * realmente distintos; para o resto dos testes, `notificar` basta.
   */
  async function notificarEm(
    dono: Pessoa,
    createdAt: string,
    overrides: { titulo?: string; tipo?: NotificationType } = {},
  ): Promise<string> {
    const id = await notificar(dono, overrides);
    await dataSource.getRepository(Notification).update(id, { createdAt: new Date(createdAt) });
    return id;
  }

  async function listar(pessoa: Pessoa, query = ''): Promise<NotificationPageResponseDto> {
    const response = await request(server())
      .get(`/notifications${query}`)
      .set('Authorization', bearer(pessoa.token))
      .expect(200);
    return response.body as NotificationPageResponseDto;
  }

  async function contar(pessoa: Pessoa): Promise<number> {
    const response = await request(server())
      .get('/notifications/unread-count')
      .set('Authorization', bearer(pessoa.token))
      .expect(200);
    return (response.body as UnreadCountResponseDto).count;
  }

  async function marcarLida(
    pessoa: Pessoa,
    id: string,
    esperado: number,
  ): Promise<NotificationResponseDto> {
    const response = await request(server())
      .patch(`/notifications/${id}/read`)
      .set('Authorization', bearer(pessoa.token))
      .expect(esperado);
    return response.body as NotificationResponseDto;
  }

  async function marcarTodas(pessoa: Pessoa): Promise<ReadAllResponseDto> {
    const response = await request(server())
      .patch('/notifications/read-all')
      .set('Authorization', bearer(pessoa.token))
      .expect(200);
    return response.body as ReadAllResponseDto;
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    notificationsService = app.get(NotificationsService, { strict: false });
    dataSource = app.get(DataSource, { strict: false });
  });

  beforeEach(async () => {
    // Pessoas novas a cada teste: cada uma comeca sem nenhuma notificacao, e um
    // teste nunca enxerga o que o anterior criou.
    ana = await criarPessoa('ana');
    bruno = await criarPessoa('bruno');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('acesso', () => {
    const rotas: [string, 'get' | 'patch', string][] = [
      ['lista', 'get', '/notifications'],
      ['contador', 'get', '/notifications/unread-count'],
      ['consulta', 'get', '/notifications/3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
      ['marcar lida', 'patch', '/notifications/3f2504e0-4f89-11d3-9a0c-0305e82c3301/read'],
      ['marcar todas', 'patch', '/notifications/read-all'],
    ];

    it.each(rotas)('%s sem token: 401', async (_nome, metodo, rota) => {
      await request(server())[metodo](rota).expect(401);
    });

    /**
     * Ver as proprias notificacoes nao e privilegio administrativo: qualquer
     * perfil autenticado acessa, sem permissao granular nova.
     */
    it.each([RoleName.Admin, RoleName.Gestor, RoleName.Operador, RoleName.Usuario])(
      'perfil %s acessa as proprias notificacoes',
      async (role) => {
        const pessoa = await criarPessoa('perfil', role);

        expect(await listar(pessoa)).toMatchObject({ items: [], total: 0 });
      },
    );

    it('nao existe rota para o usuario criar notificacao', async () => {
      await request(server())
        .post('/notifications')
        .set('Authorization', bearer(ana.token))
        .send({ titulo: 'x', mensagem: 'y', tipo: 'INFO' })
        .expect(404);
    });

    it('nao existe rota para apagar notificacao', async () => {
      const id = await notificar(ana);

      await request(server())
        .delete(`/notifications/${id}`)
        .set('Authorization', bearer(ana.token))
        .expect(404);
    });

    it('unread-count nao e confundido com um id', async () => {
      // `:id` usa ParseUUIDPipe: se a rota estatica nao viesse antes, esta
      // chamada responderia 400 em vez do contador.
      expect(await contar(ana)).toBe(0);
    });
  });

  describe('isolamento por usuario', () => {
    it('cada um ve somente as suas', async () => {
      await notificar(ana, { titulo: 'Da Ana' });
      await notificar(bruno, { titulo: 'Do Bruno' });

      const daAna = await listar(ana);
      const doBruno = await listar(bruno);

      expect(daAna.items.map((n) => n.titulo)).toEqual(['Da Ana']);
      expect(doBruno.items.map((n) => n.titulo)).toEqual(['Do Bruno']);
    });

    it('o total tambem e so do usuario', async () => {
      await notificar(ana);
      await notificar(ana);
      await notificar(bruno);

      expect((await listar(ana)).total).toBe(2);
      expect((await listar(bruno)).total).toBe(1);
    });

    it('consultar notificacao alheia responde 404, igual a um id inexistente', async () => {
      const daAna = await notificar(ana);

      const alheia = await request(server())
        .get(`/notifications/${daAna}`)
        .set('Authorization', bearer(bruno.token))
        .expect(404);
      const inexistente = await request(server())
        .get('/notifications/3f2504e0-4f89-11d3-9a0c-0305e82c3301')
        .set('Authorization', bearer(bruno.token))
        .expect(404);

      // Mesma resposta nos dois casos - so `path` e `timestamp` diferem, e os
      // dois vem do filtro global de erros. Nada revela que aquele id existe.
      const semContexto = (corpo: object): object => {
        const { path: _path, timestamp: _timestamp, ...resto } = corpo as Record<string, unknown>;
        return resto;
      };
      expect(semContexto(alheia.body as object)).toEqual(semContexto(inexistente.body as object));
      expect(semContexto(alheia.body as object)).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Notificacao nao encontrada',
      });
    });

    it('a resposta nao expoe o id do destinatario', async () => {
      const id = await notificar(ana);

      const response = await request(server())
        .get(`/notifications/${id}`)
        .set('Authorization', bearer(ana.token))
        .expect(200);

      expect(Object.keys(response.body as object).sort()).toEqual(
        ['createdAt', 'id', 'lida', 'mensagem', 'readAt', 'tipo', 'titulo', 'updatedAt'].sort(),
      );
    });
  });

  describe('GET /notifications', () => {
    it('lista vazia: total zero e uma pagina', async () => {
      expect(await listar(ana)).toEqual({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 });
    });

    it('nao lidas vem antes das lidas, mesmo sendo mais antigas', async () => {
      // A LIDA e a mais recente das tres: se `created_at` mandasse sozinho, ela
      // viria primeiro. A regra "nao lidas primeiro" tem de vencer.
      const antiga = await notificarEm(ana, '2026-09-20T10:00:00.000Z', { titulo: 'Antiga' });
      await notificarEm(ana, '2026-09-21T10:00:00.000Z', { titulo: 'Do meio' });
      const recente = await notificarEm(ana, '2026-09-22T10:00:00.000Z', { titulo: 'Recente' });
      await marcarLida(ana, recente, 200);

      const { items } = await listar(ana);

      expect(items.map((n) => n.titulo)).toEqual(['Do meio', 'Antiga', 'Recente']);
      expect(items[0].lida).toBe(false);
      expect(items[2]).toMatchObject({ id: recente, lida: true });
      expect(antiga).not.toBe(recente);
    });

    it('dentro do mesmo grupo, as mais recentes vem primeiro', async () => {
      await notificarEm(ana, '2026-09-20T10:00:00.000Z', { titulo: 'Primeira' });
      await notificarEm(ana, '2026-09-21T10:00:00.000Z', { titulo: 'Segunda' });
      await notificarEm(ana, '2026-09-22T10:00:00.000Z', { titulo: 'Terceira' });

      const { items } = await listar(ana);

      expect(items.map((n) => n.titulo)).toEqual(['Terceira', 'Segunda', 'Primeira']);
    });

    it('pagina de verdade no backend: cada pagina traz itens diferentes', async () => {
      for (const titulo of ['A', 'B', 'C', 'D', 'E']) {
        await notificar(ana, { titulo });
      }

      const primeira = await listar(ana, '?page=1&limit=2');
      const segunda = await listar(ana, '?page=2&limit=2');
      const terceira = await listar(ana, '?page=3&limit=2');

      expect(primeira.items).toHaveLength(2);
      expect(segunda.items).toHaveLength(2);
      expect(terceira.items).toHaveLength(1);
      expect(primeira.items.map((n) => n.id)).not.toEqual(segunda.items.map((n) => n.id));
    });

    it('informa page, limit, total e totalPages', async () => {
      for (const titulo of ['A', 'B', 'C', 'D', 'E']) {
        await notificar(ana, { titulo });
      }

      expect(await listar(ana, '?page=2&limit=2')).toMatchObject({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
    });

    it('pagina alem do fim vem vazia, com o total correto', async () => {
      await notificar(ana);

      expect(await listar(ana, '?page=9&limit=20')).toMatchObject({ items: [], total: 1 });
    });

    it.each([
      ['page zero', '?page=0'],
      ['limit zero', '?limit=0'],
      ['limit acima do maximo', '?limit=101'],
      ['page nao numerico', '?page=abc'],
      ['filtro nao previsto', '?usuarioId=outro'],
    ])('%s: 400', async (_nome, query) => {
      await request(server())
        .get(`/notifications${query}`)
        .set('Authorization', bearer(ana.token))
        .expect(400);
    });
  });

  describe('GET /notifications/unread-count', () => {
    it('sem notificacoes: zero', async () => {
      expect(await contar(ana)).toBe(0);
    });

    it('conta as nao lidas', async () => {
      await notificar(ana);
      await notificar(ana);
      await notificar(ana);

      expect(await contar(ana)).toBe(3);
    });

    it('nao conta as ja lidas', async () => {
      const id = await notificar(ana);
      await notificar(ana);

      await marcarLida(ana, id, 200);

      expect(await contar(ana)).toBe(1);
    });

    it('notificacao de outro usuario nao entra no contador', async () => {
      await notificar(bruno);
      await notificar(bruno);

      expect(await contar(ana)).toBe(0);
      expect(await contar(bruno)).toBe(2);
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    it('nao lida passa a lida', async () => {
      const id = await notificar(ana);

      expect(await marcarLida(ana, id, 200)).toMatchObject({ id, lida: true });
      expect(await contar(ana)).toBe(0);
    });

    it('idempotente: marcar de novo continua 200 e lida', async () => {
      const id = await notificar(ana);

      await marcarLida(ana, id, 200);
      const segunda = await marcarLida(ana, id, 200);

      expect(segunda.lida).toBe(true);
      expect((await listar(ana)).total).toBe(1);
    });

    it('notificacao de outro usuario: 404 e continua nao lida', async () => {
      const daAna = await notificar(ana);

      await request(server())
        .patch(`/notifications/${daAna}/read`)
        .set('Authorization', bearer(bruno.token))
        .expect(404);

      expect(await contar(ana)).toBe(1);
    });

    it('id que nao e UUID: 400', async () => {
      await request(server())
        .patch('/notifications/nao-e-uuid/read')
        .set('Authorization', bearer(ana.token))
        .expect(400);
    });

    it.each([
      ['usuarioId', { usuarioId: 'outro-usuario' }],
      ['userId', { userId: 'outro-usuario' }],
      ['lida', { lida: false }],
    ])('corpo tentando enviar %s: 400', async (_nome, corpo) => {
      const id = await notificar(ana);

      await request(server())
        .patch(`/notifications/${id}/read`)
        .set('Authorization', bearer(ana.token))
        .send(corpo)
        .expect(400);

      // A tentativa nao teve efeito nenhum.
      expect(await contar(ana)).toBe(1);
    });
  });

  describe('PATCH /notifications/read-all', () => {
    it('marca todas as nao lidas e informa quantas eram', async () => {
      await notificar(ana);
      await notificar(ana);

      expect(await marcarTodas(ana)).toEqual({ atualizadas: 2 });
      expect(await contar(ana)).toBe(0);
    });

    it('as ja lidas continuam lidas e nao sao recontadas', async () => {
      const id = await notificar(ana);
      await notificar(ana);
      await marcarLida(ana, id, 200);

      expect(await marcarTodas(ana)).toEqual({ atualizadas: 1 });
      expect((await listar(ana)).items.every((n) => n.lida)).toBe(true);
    });

    it('idempotente: repetir devolve zero e nao quebra', async () => {
      await notificar(ana);

      await marcarTodas(ana);

      expect(await marcarTodas(ana)).toEqual({ atualizadas: 0 });
      expect(await contar(ana)).toBe(0);
    });

    it('sem nenhuma notificacao: zero', async () => {
      expect(await marcarTodas(ana)).toEqual({ atualizadas: 0 });
    });

    it('nao alcanca as notificacoes de outro usuario', async () => {
      await notificar(ana);
      await notificar(bruno);
      await notificar(bruno);

      await marcarTodas(ana);

      expect(await contar(ana)).toBe(0);
      expect(await contar(bruno)).toBe(2);
    });

    it('corpo tentando enviar usuarioId: 400 e nada muda', async () => {
      await notificar(ana);

      await request(server())
        .patch('/notifications/read-all')
        .set('Authorization', bearer(ana.token))
        .send({ usuarioId: bruno.id })
        .expect(400);

      expect(await contar(ana)).toBe(1);
    });
  });

  /**
   * `read_at` e o UPDATE direcionado de "marcar como lida".
   *
   * Estes testes conferem a LINHA NO BANCO, e nao so a resposta HTTP: a
   * propriedade em jogo e o que ficou persistido.
   */
  describe('readAt e gravacao direcionada', () => {
    interface LinhaCrua {
      usuario_id: string;
      titulo: string;
      mensagem: string;
      tipo: string;
      lida: boolean;
      created_at: string;
      read_at: string | null;
    }

    /** A linha como esta no banco, sem passar pela API. */
    async function linha(id: string): Promise<LinhaCrua> {
      const [row] = await dataSource.query<(Omit<LinhaCrua, 'lida'> & { lida: number })[]>(
        'SELECT usuario_id, titulo, mensagem, tipo, lida, created_at, read_at FROM notifications WHERE id = ?',
        [id],
      );
      return { ...row, lida: Boolean(row.lida) };
    }

    /** Horario de leitura fixo e antigo, para provar que nada o sobrescreve. */
    const LIDA_ANTES = '2026-01-02 03:04:05.678';

    it('nasce com lida = false e readAt nulo, no banco e na resposta', async () => {
      const id = await notificar(ana);

      expect(await linha(id)).toMatchObject({ lida: false, read_at: null });
      expect((await listar(ana)).items[0]).toMatchObject({ id, lida: false, readAt: null });
    });

    it('marcar como lida preenche readAt, no banco e na resposta', async () => {
      const id = await notificar(ana);
      const antes = Date.now();

      const resposta = await marcarLida(ana, id, 200);

      expect(resposta.lida).toBe(true);
      expect(resposta.readAt).not.toBeNull();
      expect(new Date(resposta.readAt as unknown as string).getTime()).toBeGreaterThanOrEqual(
        antes - 1000,
      );
      const depois = await linha(id);
      expect(depois.lida).toBe(true);
      expect(depois.read_at).not.toBeNull();
    });

    it('marcar de novo nao altera o readAt da primeira leitura', async () => {
      const id = await notificar(ana);
      await marcarLida(ana, id, 200);
      await dataSource.query('UPDATE notifications SET read_at = ? WHERE id = ?', [LIDA_ANTES, id]);

      const segunda = await marcarLida(ana, id, 200);

      expect((await linha(id)).read_at).toBe(LIDA_ANTES);
      expect(new Date(segunda.readAt as unknown as string).getTime()).toBe(
        new Date(`${LIDA_ANTES.replace(' ', 'T')}Z`).getTime(),
      );
    });

    it('so lida, read_at e updated_at mudam: o resto da linha fica intacto', async () => {
      const id = await notificar(ana, { titulo: 'Intacta', tipo: NotificationType.Warning });
      const antes = await linha(id);

      await marcarLida(ana, id, 200);

      const { lida, read_at: readAt, ...resto } = await linha(id);
      const { lida: _l, read_at: _r, ...restoAntes } = antes;
      expect(resto).toEqual(restoAntes);
      expect(lida).toBe(true);
      expect(readAt).not.toBeNull();
    });

    it('requisicoes simultaneas: todas 200, uma unica leitura gravada', async () => {
      const id = await notificar(ana);

      const respostas = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server())
            .patch(`/notifications/${id}/read`)
            .set('Authorization', bearer(ana.token)),
        ),
      );

      expect(respostas.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const horarios = new Set(
        respostas.map((r) => (r.body as NotificationResponseDto).readAt as unknown as string),
      );
      // Todas devolvem o MESMO horario: nenhuma sobrescreveu a primeira.
      expect(horarios.size).toBe(1);
      expect(await linha(id)).toMatchObject({ lida: true });
      expect(await contar(ana)).toBe(0);
    });

    it('outro usuario tentando marcar: a linha da dona continua sem readAt', async () => {
      const id = await notificar(ana);

      await marcarLida(bruno, id, 404);

      expect(await linha(id)).toMatchObject({ lida: false, read_at: null, usuario_id: ana.id });
    });

    it('read-all preenche readAt das nao lidas e preserva o das ja lidas', async () => {
      const jaLida = await notificar(ana);
      const nova = await notificar(ana);
      await marcarLida(ana, jaLida, 200);
      await dataSource.query('UPDATE notifications SET read_at = ? WHERE id = ?', [
        LIDA_ANTES,
        jaLida,
      ]);

      expect(await marcarTodas(ana)).toEqual({ atualizadas: 1 });

      expect((await linha(jaLida)).read_at).toBe(LIDA_ANTES);
      expect(await linha(nova)).toMatchObject({ lida: true });
      expect((await linha(nova)).read_at).not.toBeNull();
    });

    it('read-all nao preenche readAt de notificacao de outro usuario', async () => {
      await notificar(ana);
      const doBruno = await notificar(bruno);

      await marcarTodas(ana);

      expect(await linha(doBruno)).toMatchObject({ lida: false, read_at: null });
    });
  });

  describe('criacao interna', () => {
    it('a notificacao nasce por ler, para o destinatario informado', async () => {
      await notificar(ana, { titulo: 'Bem-vinda', tipo: NotificationType.Success });

      const { items } = await listar(ana);

      expect(items[0]).toMatchObject({
        titulo: 'Bem-vinda',
        tipo: NotificationType.Success,
        lida: false,
      });
    });

    it.each(Object.values(NotificationType))('aceita o tipo %s', async (tipo) => {
      await notificar(ana, { tipo });

      expect((await listar(ana)).items[0].tipo).toBe(tipo);
    });

    it.each([
      ['titulo vazio', { titulo: '' }],
      ['mensagem vazia', { mensagem: '' }],
      ['titulo longo demais', { titulo: 'a'.repeat(121) }],
      ['tipo invalido', { tipo: 'URGENTE' as NotificationType }],
    ])('recusa %s, e nada e gravado', async (_nome, invalido) => {
      await expect(
        notificationsService.createForUser({
          usuarioId: ana.id,
          titulo: 'Titulo',
          mensagem: 'Mensagem',
          tipo: NotificationType.Info,
          ...invalido,
        }),
      ).rejects.toThrow(/Notificacao invalida/);

      expect((await listar(ana)).total).toBe(0);
    });
  });

  describe('auditoria', () => {
    /**
     * Decisao documentada em `NotificationsService`: consultar e marcar como
     * lida nao entram na trilha. Este teste trava a decisao - se alguem
     * acrescentar auditoria aqui, ele falha e a mudanca vira deliberada.
     */
    it('nenhuma operacao de notificacao gera registro de auditoria', async () => {
      const admin = await criarPessoa('admin', RoleName.Admin);
      const antes = await totalDeEventos(admin);

      const id = await notificar(admin);
      await listar(admin);
      await contar(admin);
      await request(server())
        .get(`/notifications/${id}`)
        .set('Authorization', bearer(admin.token))
        .expect(200);
      await marcarLida(admin, id, 200);
      await marcarTodas(admin);

      expect(await totalDeEventos(admin)).toBe(antes);
    });

    async function totalDeEventos(admin: Pessoa): Promise<number> {
      const response = await request(server())
        .get('/audit-logs?limit=100')
        .set('Authorization', bearer(admin.token))
        .expect(200);
      return (response.body as AuditLogPageResponseDto).total;
    }
  });
});
