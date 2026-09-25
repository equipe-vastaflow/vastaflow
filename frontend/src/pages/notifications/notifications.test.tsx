import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { AppNotification, NotificationPage, RoleName, User } from '../../api/client';
import { AuthProvider } from '../../auth/AuthContext';

type Reply = { status: number; body?: unknown };
type Handler = Reply | ((init: RequestInit | undefined) => Reply | Promise<Reply>);

/** Substitui o `fetch` por respostas indexadas por "METODO /caminho" (sem query string). */
function mockApi(routes: Record<string, Handler>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) {
      throw new TypeError(`fetch nao mockado: ${key}`);
    }
    const reply = typeof handler === 'function' ? await handler(init) : handler;
    return reply.body === undefined
      ? new Response(null, { status: reply.status })
      : new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json' },
        });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeUser(id: string, role: RoleName, permissions: string[] = []): User {
  return {
    id,
    nome: `Pessoa ${id}`,
    email: `${id}@vasta.test`,
    role,
    permissions,
    ativo: true,
    createdAt: '2026-03-10T12:00:00.000Z',
    updatedAt: '2026-03-10T12:00:00.000Z',
  };
}

/** Perfil sem nenhuma permissao: notificacoes nao sao privilegio administrativo. */
const COMUM = makeUser('comum', 'USUARIO');

function notificacao(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'notif-1',
    titulo: 'Lançamento aprovado',
    mensagem: 'O lançamento de manutenção foi marcado como pago.',
    tipo: 'SUCCESS',
    lida: false,
    createdAt: '2026-09-22T12:30:00.000Z',
    updatedAt: '2026-09-22T12:30:00.000Z',
    ...overrides,
  };
}

const NAO_LIDA = notificacao();
const LIDA = notificacao({
  id: 'notif-2',
  titulo: 'Relatório disponível',
  mensagem: 'O fechamento do mês está pronto para consulta.',
  tipo: 'INFO',
  lida: true,
});

const pagina = (items: AppNotification[], total = items.length, page = 1): NotificationPage => ({
  items,
  total,
  page,
  limit: 20,
  totalPages: Math.max(1, Math.ceil(total / 20)),
});

function renderAt(
  path: string,
  me: User,
  extra: Record<string, Handler> = {},
): ReturnType<typeof vi.fn> {
  localStorage.setItem(
    'vastaflow.session',
    JSON.stringify({ token: 'jwt-guardado', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
  const fetchMock = mockApi({
    'GET /auth/me': { status: 200, body: me },
    'GET /dashboard/summary': { status: 200, body: {} },
    'GET /notifications': { status: 200, body: pagina([NAO_LIDA, LIDA]) },
    'GET /notifications/unread-count': { status: 200, body: { count: 1 } },
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

const heading = (name: string): Promise<HTMLElement> => screen.findByRole('heading', { name });

/** Cartao da notificacao cujo titulo foi informado. */
async function cartao(titulo: string): Promise<HTMLElement> {
  const alvo = await screen.findByRole('heading', { name: titulo });
  const item = alvo.closest('li');
  if (!item) {
    throw new Error(`cartao de "${titulo}" nao encontrado`);
  }
  return item;
}

function chamadas(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit][] {
  return fetchMock.mock.calls as [string, RequestInit][];
}

function patches(fetchMock: ReturnType<typeof vi.fn>, caminho: string): [string, RequestInit][] {
  return chamadas(fetchMock).filter(
    ([url, init]) => init.method === 'PATCH' && url.includes(caminho),
  );
}

describe('Tela de notificacoes', () => {
  describe('acesso', () => {
    it('qualquer usuario autenticado acessa as proprias notificacoes', async () => {
      renderAt('/notifications', COMUM);

      expect(await heading('Notificações')).toBeInTheDocument();
    });

    it('o menu leva para a tela', async () => {
      renderAt('/dashboard', COMUM);
      await heading('Dashboard');

      expect(screen.getByRole('link', { name: /Notificações/ })).toHaveAttribute(
        'href',
        '/notifications',
      );
    });
  });

  describe('contador de nao lidas', () => {
    it('aparece no menu quando ha alguma por ler', async () => {
      renderAt('/dashboard', COMUM, {
        'GET /notifications/unread-count': { status: 200, body: { count: 3 } },
      });
      await heading('Dashboard');

      const menu = await screen.findByLabelText('3 não lidas');
      expect(menu).toHaveTextContent('3');
    });

    it('nao aparece quando esta zerado', async () => {
      renderAt('/dashboard', COMUM, {
        'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
      });
      await heading('Dashboard');

      await waitFor(() => {
        expect(screen.queryByLabelText(/não lidas/)).not.toBeInTheDocument();
      });
    });

    it('uma unica consulta alimenta o contador, nao uma por notificacao', async () => {
      const fetchMock = renderAt('/notifications', COMUM);
      await heading('Notificações');
      await screen.findByRole('heading', { name: NAO_LIDA.titulo });

      const contagens = chamadas(fetchMock).filter(([url]) => url.includes('/unread-count'));
      expect(contagens.length).toBeLessThanOrEqual(2);
    });

    it('falha ao consultar o contador nao derruba a navegacao', async () => {
      renderAt('/dashboard', COMUM, {
        'GET /notifications/unread-count': { status: 500, body: {} },
      });

      expect(await heading('Dashboard')).toBeInTheDocument();
      expect(screen.queryByLabelText(/não lidas/)).not.toBeInTheDocument();
    });

    it('a tela diz quantas estao por ler', async () => {
      renderAt('/notifications', COMUM, {
        'GET /notifications/unread-count': { status: 200, body: { count: 2 } },
      });

      expect(await screen.findByText('2 notificações por ler.')).toBeInTheDocument();
    });

    it('sem nenhuma por ler, a tela diz isso', async () => {
      renderAt('/notifications', COMUM, {
        'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
        'GET /notifications': { status: 200, body: pagina([LIDA]) },
      });

      expect(await screen.findByText('Nenhuma notificação por ler.')).toBeInTheDocument();
    });
  });

  describe('estados da lista', () => {
    it('mostra o estado de carregamento antes da resposta', async () => {
      renderAt('/notifications', COMUM, {
        'GET /notifications': () =>
          new Promise<Reply>((resolve) => {
            setTimeout(() => {
              resolve({ status: 200, body: pagina([NAO_LIDA]) });
            }, 30);
          }),
      });

      expect(await screen.findByText('Carregando notificações…')).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: NAO_LIDA.titulo })).toBeInTheDocument();
    });

    it('lista preenchida mostra titulo, mensagem, tipo e data/hora', async () => {
      renderAt('/notifications', COMUM);
      const item = await cartao(NAO_LIDA.titulo);

      expect(within(item).getByText(NAO_LIDA.mensagem)).toBeInTheDocument();
      expect(within(item).getByText('Sucesso')).toBeInTheDocument();
      expect(within(item).getByText(/22\/09\/2026/)).toBeInTheDocument();
    });

    it('o tipo aparece escrito, nao apenas como cor', async () => {
      renderAt('/notifications', COMUM, {
        'GET /notifications': {
          status: 200,
          body: pagina([
            notificacao({ id: 'a', titulo: 'Aviso A', tipo: 'WARNING' }),
            notificacao({ id: 'b', titulo: 'Aviso B', tipo: 'ERROR' }),
          ]),
        },
      });

      expect(within(await cartao('Aviso A')).getByText('Atenção')).toBeInTheDocument();
      expect(within(await cartao('Aviso B')).getByText('Erro')).toBeInTheDocument();
    });

    it('lida e nao lida sao distinguidas por texto, nao so por cor', async () => {
      renderAt('/notifications', COMUM);

      expect(within(await cartao(NAO_LIDA.titulo)).getByText('Não lida')).toBeInTheDocument();
      expect(within(await cartao(LIDA.titulo)).getByText('Lida')).toBeInTheDocument();
    });

    it('lista vazia diz que nao ha notificacoes', async () => {
      renderAt('/notifications', COMUM, {
        'GET /notifications': { status: 200, body: pagina([], 0) },
        'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
      });

      expect(
        await screen.findByText(
          'Nenhuma notificação ainda. Os avisos do sistema aparecem aqui conforme acontecem.',
        ),
      ).toBeInTheDocument();
    });

    it('erro na consulta mostra alerta e permite tentar de novo', async () => {
      let tentativas = 0;
      renderAt('/notifications', COMUM, {
        'GET /notifications': () => {
          tentativas += 1;
          return tentativas === 1
            ? { status: 500, body: {} }
            : { status: 200, body: pagina([NAO_LIDA]) };
        },
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível carregar as notificações.',
      );

      await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByRole('heading', { name: NAO_LIDA.titulo })).toBeInTheDocument();
    });

    it('pagina pelo backend: pede a pagina seguinte em vez de fatiar no cliente', async () => {
      const muitas = Array.from({ length: 20 }, (_, i) =>
        notificacao({ id: `n${i}`, titulo: `Aviso ${i}` }),
      );
      const fetchMock = renderAt('/notifications', COMUM, {
        'GET /notifications': { status: 200, body: pagina(muitas, 45) },
      });
      await screen.findByRole('heading', { name: 'Aviso 0' });

      await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

      await waitFor(() => {
        const ultima = chamadas(fetchMock)
          .filter(([url]) => url.includes('/notifications?'))
          .at(-1);
        expect(new URL(ultima?.[0] ?? '').searchParams.get('page')).toBe('2');
      });
    });
  });

  describe('marcar uma como lida', () => {
    it('so a nao lida oferece o botao', async () => {
      renderAt('/notifications', COMUM);

      expect(
        within(await cartao(NAO_LIDA.titulo)).getByRole('button', { name: 'Marcar como lida' }),
      ).toBeInTheDocument();
      expect(
        within(await cartao(LIDA.titulo)).queryByRole('button', { name: 'Marcar como lida' }),
      ).not.toBeInTheDocument();
    });

    it('marca, avisa e atualiza a lista sem recarregar a pagina', async () => {
      let lida = false;
      const fetchMock = renderAt('/notifications', COMUM, {
        'GET /notifications': () => ({
          status: 200,
          body: pagina([notificacao({ lida }), LIDA]),
        }),
        'GET /notifications/unread-count': () => ({
          status: 200,
          body: { count: lida ? 0 : 1 },
        }),
        'PATCH /notifications/notif-1/read': () => {
          lida = true;
          return { status: 200, body: notificacao({ lida: true }) };
        },
      });

      const item = await cartao(NAO_LIDA.titulo);
      await userEvent.click(within(item).getByRole('button', { name: 'Marcar como lida' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        `"${NAO_LIDA.titulo}" marcada como lida.`,
      );
      // A lista e o contador foram relidos - e nao houve recarga do navegador.
      await waitFor(() => {
        expect(within(item).queryByRole('button', { name: 'Marcar como lida' })).toBeNull();
      });
      expect(await screen.findByText('Nenhuma notificação por ler.')).toBeInTheDocument();
      expect(patches(fetchMock, '/notifications/notif-1/read')).toHaveLength(1);
    });

    it('duplo clique dispara apenas uma requisicao', async () => {
      let concluir: (reply: Reply) => void = () => undefined;
      const fetchMock = renderAt('/notifications', COMUM, {
        'PATCH /notifications/notif-1/read': () =>
          new Promise<Reply>((resolve) => {
            concluir = resolve;
          }),
      });

      const item = await cartao(NAO_LIDA.titulo);
      await userEvent.click(within(item).getByRole('button', { name: 'Marcar como lida' }));
      expect(within(item).getByRole('button', { name: 'Marcando…' })).toBeDisabled();
      await userEvent.click(within(item).getByRole('button', { name: 'Marcando…' }));

      concluir({ status: 200, body: notificacao({ lida: true }) });

      await waitFor(() => {
        expect(patches(fetchMock, '/notifications/notif-1/read')).toHaveLength(1);
      });
    });

    it('404 fala de notificacao, nao de usuario', async () => {
      renderAt('/notifications', COMUM, {
        'PATCH /notifications/notif-1/read': { status: 404, body: { message: 'nao encontrada' } },
      });

      const item = await cartao(NAO_LIDA.titulo);
      await userEvent.click(within(item).getByRole('button', { name: 'Marcar como lida' }));

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Notificação não encontrada.');
      expect(alerta).not.toHaveTextContent('Usuário');
    });

    it('401 encerra a sessao e leva ao login', async () => {
      renderAt('/notifications', COMUM, {
        'PATCH /notifications/notif-1/read': { status: 401, body: { message: 'expirado' } },
        'POST /auth/logout': { status: 204 },
      });

      const item = await cartao(NAO_LIDA.titulo);
      await userEvent.click(within(item).getByRole('button', { name: 'Marcar como lida' }));

      expect(await screen.findByText('Entre com sua conta para continuar.')).toBeInTheDocument();
    });
  });

  describe('marcar todas como lidas', () => {
    it('o botao aparece quando ha pelo menos uma por ler', async () => {
      renderAt('/notifications', COMUM);

      expect(
        await screen.findByRole('button', { name: 'Marcar todas como lidas' }),
      ).toBeInTheDocument();
    });

    it('o botao some quando nao ha nenhuma por ler', async () => {
      renderAt('/notifications', COMUM, {
        'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
        'GET /notifications': { status: 200, body: pagina([LIDA]) },
      });
      await heading('Notificações');

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Marcar todas como lidas' }),
        ).not.toBeInTheDocument();
      });
    });

    it('marca, zera o contador e atualiza a lista sem recarregar', async () => {
      let todasLidas = false;
      const fetchMock = renderAt('/notifications', COMUM, {
        'GET /notifications': () => ({
          status: 200,
          body: pagina([notificacao({ lida: todasLidas }), LIDA]),
        }),
        'GET /notifications/unread-count': () => ({
          status: 200,
          body: { count: todasLidas ? 0 : 1 },
        }),
        'PATCH /notifications/read-all': () => {
          todasLidas = true;
          return { status: 200, body: { atualizadas: 1 } };
        },
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        '1 notificação marcada como lida.',
      );
      expect(await screen.findByText('Nenhuma notificação por ler.')).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Marcar todas como lidas' }),
        ).not.toBeInTheDocument();
      });
      expect(patches(fetchMock, '/notifications/read-all')).toHaveLength(1);
    });

    it('o plural aparece quando mais de uma e marcada', async () => {
      renderAt('/notifications', COMUM, {
        'PATCH /notifications/read-all': { status: 200, body: { atualizadas: 4 } },
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        '4 notificações marcadas como lidas.',
      );
    });

    it('duplo clique dispara apenas uma requisicao', async () => {
      let concluir: (reply: Reply) => void = () => undefined;
      const fetchMock = renderAt('/notifications', COMUM, {
        'PATCH /notifications/read-all': () =>
          new Promise<Reply>((resolve) => {
            concluir = resolve;
          }),
      });

      const botao = await screen.findByRole('button', { name: 'Marcar todas como lidas' });
      await userEvent.click(botao);
      expect(await screen.findByRole('button', { name: 'Marcando…' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Marcando…' }));

      concluir({ status: 200, body: { atualizadas: 1 } });

      await waitFor(() => {
        expect(patches(fetchMock, '/notifications/read-all')).toHaveLength(1);
      });
    });

    it('erro no servidor aparece como alerta, sem quebrar a tela', async () => {
      renderAt('/notifications', COMUM, {
        'PATCH /notifications/read-all': { status: 500, body: {} },
      });

      await userEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: NAO_LIDA.titulo })).toBeInTheDocument();
    });
  });
});
