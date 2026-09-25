import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { AuditLogEntry, AuditLogPage, RoleName, User } from '../../api/client';
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

const GESTOR = makeUser('gestor', 'GESTOR', ['users:read', 'audit:read']);
const SO_AUDITORIA = makeUser('auditor', 'OPERADOR', ['audit:read']);
const SEM_ACESSO = makeUser('comum', 'USUARIO');

const EVENTO: AuditLogEntry = {
  id: 'log-1',
  usuarioId: 'abcdef12-3456-7890-abcd-ef1234567890',
  usuario: {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    nome: 'Gabi Gestora',
    email: 'gestor@vasta.test',
  },
  acao: 'USER_DEACTIVATED',
  modulo: 'USERS',
  descricao: 'Usuario alvo@vasta.test desativado por gestor@vasta.test',
  createdAt: '2026-09-22T12:30:00.000Z',
};

const SEM_RESPONSAVEL: AuditLogEntry = {
  id: 'log-2',
  usuarioId: null,
  usuario: null,
  acao: 'LOGIN_FAILED',
  modulo: 'AUTH',
  descricao: 'Login recusado: credenciais invalidas (fantasma@vasta.test)',
  createdAt: '2026-09-22T12:00:00.000Z',
};

const pagina = (items: AuditLogEntry[], total = items.length, page = 1): AuditLogPage => ({
  items,
  total,
  page,
  limit: 20,
});

function renderAt(path: string, me: User, extra: Record<string, Handler> = {}): ReturnType<typeof vi.fn> {
  localStorage.setItem(
    'vastaflow.session',
    JSON.stringify({ token: 'jwt-guardado', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
  const fetchMock = mockApi({
    'GET /auth/me': { status: 200, body: me },
    // O contador do menu consulta isto em toda pagina autenticada.
    'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
    'GET /dashboard/summary': { status: 200, body: { auditoria: { total: 2, recentes: [] } } },
    'GET /audit-logs': { status: 200, body: pagina([EVENTO, SEM_RESPONSAVEL]) },
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

/** Query string da ultima chamada a /audit-logs. */
function ultimaConsulta(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
  const calls = fetchMock.mock.calls as [string, RequestInit][];
  const url = [...calls].reverse().find(([u]) => u.includes('/audit-logs'))?.[0];
  if (!url) {
    throw new Error('nenhuma chamada a /audit-logs');
  }
  return new URL(url).searchParams;
}

describe('Tela de auditoria', () => {
  describe('acesso', () => {
    it('quem tem audit:read acessa a tela', async () => {
      renderAt('/audit-logs', GESTOR);

      expect(await heading('Auditoria')).toBeInTheDocument();
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('quem NAO tem audit:read nao ve a tela nem consulta a API', async () => {
      const fetchMock = renderAt('/audit-logs', SEM_ACESSO);

      expect(await heading('Acesso negado')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      const caminhos = (fetchMock.mock.calls as [string][]).map(([url]) => new URL(url).pathname);
      expect(caminhos).not.toContain('/audit-logs');
    });

    it('sem sessao, a tela exige login', async () => {
      localStorage.clear();
      mockApi({});
      render(
        <MemoryRouter initialEntries={['/audit-logs']}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    });

    it('envia o token da sessao no cabecalho', async () => {
      const fetchMock = renderAt('/audit-logs', GESTOR);

      await heading('Auditoria');
      const chamada = (fetchMock.mock.calls as [string, RequestInit][]).find(([url]) =>
        url.includes('/audit-logs'),
      );
      expect(chamada?.[1].headers).toMatchObject({ Authorization: 'Bearer jwt-guardado' });
    });
  });

  describe('listagem', () => {
    it('mostra data/hora, responsavel, acao, modulo e descricao', async () => {
      renderAt('/audit-logs', GESTOR);

      await screen.findByRole('table');
      const linhas = screen.getAllByRole('row').slice(1);
      expect(linhas).toHaveLength(2);

      const primeira = within(linhas[0]);
      expect(primeira.getByText(/22\/09\/2026/)).toBeInTheDocument();
      expect(primeira.getByText('Gabi Gestora')).toBeInTheDocument();
      expect(primeira.getByText('gestor@vasta.test')).toBeInTheDocument();
      expect(primeira.getByText('USER_DEACTIVATED')).toBeInTheDocument();
      expect(primeira.getByText('USERS')).toBeInTheDocument();
      expect(primeira.getByText(/desativado por gestor@vasta.test/)).toBeInTheDocument();
    });

    it('evento sem responsavel aparece como nao identificado', async () => {
      renderAt('/audit-logs', GESTOR);

      await screen.findByRole('table');
      const linhas = screen.getAllByRole('row').slice(1);

      expect(within(linhas[1]).getByText('Não identificado')).toBeInTheDocument();
    });

    it('usuario que nao existe mais aparece como removido, com o id para rastrear', async () => {
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': {
          status: 200,
          // Evento antigo de um usuario que foi removido do sistema.
          body: pagina([{ ...EVENTO, usuario: null }]),
        },
      });

      await screen.findByRole('table');

      expect(screen.getByText(/Usuário removido \(abcdef12\)/)).toBeInTheDocument();
      expect(screen.queryByText('Não identificado')).not.toBeInTheDocument();
    });

    it('nao exibe IP nem metadados, mesmo se a API os devolver', async () => {
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': {
          status: 200,
          body: pagina([
            { ...EVENTO, ip: '10.0.0.5', metadados: { alvoId: 'segredo-123' } } as AuditLogEntry,
          ]),
        },
      });

      const tabela = await screen.findByRole('table');
      expect(screen.queryByText(/10\.0\.0\.5/)).not.toBeInTheDocument();
      expect(screen.queryByText(/segredo-123/)).not.toBeInTheDocument();
      expect(tabela.textContent).not.toContain('10.0.0.5');
      expect(tabela.textContent).not.toContain('segredo-123');
    });
  });

  describe('estados', () => {
    it('carregando: mostra o aviso ate a resposta chegar', async () => {
      let liberar: (() => void) | undefined;
      const espera = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': async () => {
          await espera;
          return { status: 200, body: pagina([EVENTO]) };
        },
      });

      expect(await screen.findByText('Carregando eventos…')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();

      liberar?.();

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.queryByText('Carregando eventos…')).not.toBeInTheDocument();
    });

    it('erro da API: mensagem clara e botao para tentar de novo', async () => {
      let tentativas = 0;
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': () => {
          tentativas += 1;
          return tentativas === 1
            ? { status: 500, body: { message: 'Erro interno do servidor' } }
            : { status: 200, body: pagina([EVENTO]) };
        },
      });

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(/Não foi possível carregar os eventos/);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('401 encerra a sessao e leva ao login', async () => {
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': { status: 401, body: { message: 'Token invalido' } },
        'POST /auth/logout': { status: 204 },
      });

      expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
      expect(localStorage.getItem('vastaflow.session')).toBeNull();
    });

    it('lista vazia: mostra estado vazio, sem tabela', async () => {
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': { status: 200, body: pagina([], 0) },
      });

      expect(await screen.findByText(/Nenhum evento registrado ainda/)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('paginacao', () => {
    it('pede a pagina ao backend e nao fatia no frontend', async () => {
      const fetchMock = renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': (init) => {
          void init;
          return { status: 200, body: pagina([EVENTO, SEM_RESPONSAVEL], 45) };
        },
      });

      await screen.findByRole('table');
      expect(ultimaConsulta(fetchMock).get('page')).toBe('1');
      expect(ultimaConsulta(fetchMock).get('limit')).toBe('20');
      expect(screen.getByText(/Página 1 de 3 · 45 eventos/)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

      await waitFor(() => {
        expect(ultimaConsulta(fetchMock).get('page')).toBe('2');
      });
    });

    it('desabilita Anterior na primeira pagina e Proxima na ultima', async () => {
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': { status: 200, body: pagina([EVENTO], 1) },
      });

      await screen.findByRole('table');
      expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    });

    it('sem eventos nao ha controles de paginacao', async () => {
      renderAt('/audit-logs', GESTOR, {
        'GET /audit-logs': { status: 200, body: pagina([], 0) },
      });

      await screen.findByText(/Nenhum evento registrado ainda/);
      expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument();
    });
  });

  describe('navegacao', () => {
    it('o menu leva do dashboard para a auditoria', async () => {
      renderAt('/dashboard', GESTOR);

      await heading('Dashboard');
      await userEvent.click(screen.getByRole('link', { name: 'Auditoria' }));

      expect(await heading('Auditoria')).toBeInTheDocument();
    });

    it('o atalho do dashboard leva para a tela completa', async () => {
      renderAt('/dashboard', GESTOR, {
        'GET /dashboard/summary': {
          status: 200,
          body: { auditoria: { total: 2, recentes: [] } },
        },
      });

      await screen.findByRole('heading', { name: 'Auditoria recente' });
      const atalhos = screen.getByRole('heading', { name: 'Atalhos' });
      const link = within(atalhos.parentElement as HTMLElement).getByRole('link', {
        name: /Auditoria/,
      });
      expect(link).toHaveAttribute('href', '/audit-logs');

      await userEvent.click(link);
      expect(await heading('Auditoria')).toBeInTheDocument();
    });

    it('da para voltar ao dashboard', async () => {
      renderAt('/audit-logs', GESTOR);

      await heading('Auditoria');
      await userEvent.click(screen.getByRole('link', { name: 'Voltar ao dashboard' }));

      expect(await heading('Dashboard')).toBeInTheDocument();
    });

    it('sem audit:read o menu nao mostra Auditoria', async () => {
      renderAt('/dashboard', makeUser('so-users', 'GESTOR', ['users:read']), {
        'GET /dashboard/summary': { status: 200, body: { usuarios: { total: 1, ativos: 1, inativos: 0 } } },
      });

      await heading('Dashboard');
      expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
    });

    it('quem so tem audit:read ve Auditoria, mas nao Usuarios', async () => {
      renderAt('/audit-logs', SO_AUDITORIA);

      await heading('Auditoria');
      expect(screen.getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();
    });
  });
});
