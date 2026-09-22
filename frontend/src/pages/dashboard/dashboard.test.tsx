import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { DashboardSummary, RoleName, User } from '../../api/client';
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
const COMUM = makeUser('comum', 'USUARIO');

const SUMMARY: DashboardSummary = {
  usuarios: { total: 12, ativos: 10, inativos: 2 },
  auditoria: {
    total: 128,
    recentes: [
      {
        id: 'log-1',
        acao: 'LOGIN',
        modulo: 'AUTH',
        descricao: 'Login realizado por gestor@vasta.test',
        usuario: { id: 'gestor', nome: 'Gabi Gestora' },
        createdAt: '2026-09-22T12:30:00.000Z',
      },
      {
        id: 'log-2',
        acao: 'LOGIN_FAILED',
        modulo: 'AUTH',
        descricao: 'Login recusado: credenciais invalidas (fantasma@vasta.test)',
        usuario: null,
        createdAt: '2026-09-22T12:00:00.000Z',
      },
    ],
  },
};

function renderDashboard(me: User, extra: Record<string, Handler> = {}): ReturnType<typeof vi.fn> {
  localStorage.setItem(
    'vastaflow.session',
    JSON.stringify({ token: 'jwt-guardado', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
  const fetchMock = mockApi({
    'GET /auth/me': { status: 200, body: me },
    'GET /dashboard/summary': { status: 200, body: SUMMARY },
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

const heading = (name: string): Promise<HTMLElement> => screen.findByRole('heading', { name });

/**
 * Secao de atalhos. As buscas sao restritas a ela porque "Usuários" tambem
 * existe na navegacao do `AppShell` - procurar na pagina inteira acharia os dois.
 */
async function shortcutsSection(): Promise<HTMLElement> {
  const titulo = await heading('Atalhos');
  if (!titulo.parentElement) {
    throw new Error('secao de atalhos nao encontrada');
  }
  return titulo.parentElement;
}

/** Card identificado pelo rotulo; devolve o valor mostrado. */
function statValue(label: string): string {
  const card = screen.getByText(label).closest('article');
  if (!card) {
    throw new Error(`card "${label}" nao encontrado`);
  }
  return within(card).getAllByText(/^\d+$/)[0]?.textContent ?? '';
}

describe('Dashboard', () => {
  it('mostra o cabecalho com titulo, usuario e perfil', async () => {
    renderDashboard(GESTOR);

    expect(await heading('Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/Pessoa gestor/)).toBeInTheDocument();
    expect(screen.getByText(/gestor@vasta.test/)).toBeInTheDocument();
    expect(screen.getByText('Gestor')).toBeInTheDocument();
    expect(screen.getByText('(GESTOR)')).toBeInTheDocument();
  });

  it('envia o token da sessao, sem criar outra autenticacao', async () => {
    const fetchMock = renderDashboard(GESTOR);

    await heading('Dashboard');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const chamadas = fetchMock.mock.calls as [string, RequestInit][];
    const resumo = chamadas.find(([url]) => url.includes('/dashboard/summary'));

    expect(resumo?.[1].headers).toMatchObject({ Authorization: 'Bearer jwt-guardado' });
    expect(resumo?.[1].method ?? 'GET').toBe('GET');
  });

  describe('cards de usuarios', () => {
    it('mostra total, ativos e inativos', async () => {
      renderDashboard(GESTOR);

      expect(await screen.findByText('Total de usuários')).toBeInTheDocument();
      expect(statValue('Total de usuários')).toBe('12');
      expect(statValue('Usuários ativos')).toBe('10');
      expect(statValue('Usuários inativos')).toBe('2');
    });

    it('nao aparecem quando o backend nao devolve a secao', async () => {
      renderDashboard(COMUM, {
        'GET /dashboard/summary': { status: 200, body: { auditoria: SUMMARY.auditoria } },
      });

      await heading('Dashboard');
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Auditoria recente' })).toBeInTheDocument();
      });
      expect(screen.queryByText('Total de usuários')).not.toBeInTheDocument();
    });
  });

  describe('auditoria recente', () => {
    it('lista os eventos com acao, modulo, responsavel e data', async () => {
      renderDashboard(GESTOR);

      expect(await screen.findByRole('heading', { name: 'Auditoria recente' })).toBeInTheDocument();
      // Deixa explicito que a lista e parcial: nao existe tela completa de auditoria.
      expect(
        screen.getByText('Mostrando os 2 mais recentes de 128 eventos registrados'),
      ).toBeInTheDocument();

      const linhas = screen.getAllByRole('row').slice(1);
      expect(linhas).toHaveLength(2);

      const primeira = within(linhas[0]);
      expect(primeira.getByText('LOGIN')).toBeInTheDocument();
      expect(primeira.getByText('AUTH')).toBeInTheDocument();
      expect(primeira.getByText('Gabi Gestora')).toBeInTheDocument();
      expect(primeira.getByText(/22\/09\/2026/)).toBeInTheDocument();
    });

    it('evento sem responsavel aparece como nao identificado', async () => {
      renderDashboard(GESTOR);

      await screen.findByRole('heading', { name: 'Auditoria recente' });
      const linhas = screen.getAllByRole('row').slice(1);

      expect(within(linhas[1]).getByText('Não identificado')).toBeInTheDocument();
    });

    it('nao aparece para quem nao tem a permissao (backend omite a secao)', async () => {
      renderDashboard(COMUM, {
        'GET /dashboard/summary': { status: 200, body: { usuarios: SUMMARY.usuarios } },
      });

      expect(await screen.findByText('Total de usuários')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Auditoria recente' })).not.toBeInTheDocument();
    });
  });

  describe('estado vazio', () => {
    it('sem eventos, mostra mensagem propria em vez de tabela vazia', async () => {
      renderDashboard(GESTOR, {
        'GET /dashboard/summary': {
          status: 200,
          body: { usuarios: SUMMARY.usuarios, auditoria: { total: 0, recentes: [] } },
        },
      });

      expect(await screen.findByText(/Nenhum evento registrado ainda/)).toBeInTheDocument();
      expect(screen.getByText('Nenhum evento registrado')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('perfil sem nenhum indicador ve um aviso, e nao um erro', async () => {
      renderDashboard(COMUM, { 'GET /dashboard/summary': { status: 200, body: {} } });

      expect(await screen.findByText(/não tem acesso a indicadores/i)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText('Total de usuários')).not.toBeInTheDocument();
    });
  });

  describe('carregamento', () => {
    it('mostra o estado de carregamento ate a resposta chegar', async () => {
      localStorage.setItem(
        'vastaflow.session',
        JSON.stringify({ token: 'jwt-guardado', expiresAt: Date.now() + 3_600_000 }),
      );
      let liberar: (() => void) | undefined;
      const espera = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      mockApi({
        'GET /auth/me': { status: 200, body: GESTOR },
        'GET /dashboard/summary': async () => {
          await espera;
          return { status: 200, body: SUMMARY };
        },
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByText('Carregando indicadores…')).toBeInTheDocument();
      expect(screen.queryByText('Total de usuários')).not.toBeInTheDocument();

      liberar?.();

      expect(await screen.findByText('Total de usuários')).toBeInTheDocument();
      expect(screen.queryByText('Carregando indicadores…')).not.toBeInTheDocument();
    });
  });

  describe('erro da API', () => {
    it('mostra mensagem clara e permite tentar de novo', async () => {
      let tentativas = 0;
      renderDashboard(GESTOR, {
        'GET /dashboard/summary': () => {
          tentativas += 1;
          return tentativas === 1
            ? { status: 500, body: { message: 'Erro interno do servidor' } }
            : { status: 200, body: SUMMARY };
        },
      });

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(/Não foi possível carregar os indicadores/);
      expect(screen.queryByText('Total de usuários')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByText('Total de usuários')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('falha de rede tambem tem mensagem propria', async () => {
      localStorage.setItem(
        'vastaflow.session',
        JSON.stringify({ token: 'jwt-guardado', expiresAt: Date.now() + 3_600_000 }),
      );
      // Sem rota para /dashboard/summary: o mock rejeita, virando NetworkError.
      mockApi({ 'GET /auth/me': { status: 200, body: GESTOR } });
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(/conectar ao servidor/i);
    });

    it('401 encerra a sessao e leva de volta ao login', async () => {
      renderDashboard(GESTOR, {
        'GET /dashboard/summary': { status: 401, body: { message: 'Token invalido' } },
        'POST /auth/logout': { status: 204 },
      });

      expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
      expect(localStorage.getItem('vastaflow.session')).toBeNull();
    });
  });

  describe('atalhos', () => {
    it('leva para Usuarios e para a tela de auditoria', async () => {
      renderDashboard(GESTOR);

      // O atalho de auditoria so existe depois que o resumo chega.
      await screen.findByRole('heading', { name: 'Auditoria recente' });
      const atalhos = within(await shortcutsSection());

      expect(atalhos.getByRole('link', { name: /Usuários/ })).toHaveAttribute('href', '/users');
      expect(atalhos.getByRole('link', { name: /Auditoria/ })).toHaveAttribute(
        'href',
        '/audit-logs',
      );
    });

    it('sem users:read nao ha atalho de Usuarios', async () => {
      renderDashboard(makeUser('so-audit', 'OPERADOR', ['audit:read']), {
        'GET /dashboard/summary': { status: 200, body: { auditoria: SUMMARY.auditoria } },
      });

      await screen.findByRole('heading', { name: 'Auditoria recente' });
      const atalhos = within(await shortcutsSection());

      expect(atalhos.queryByRole('link', { name: /Usuários/ })).not.toBeInTheDocument();
      expect(atalhos.getByRole('link', { name: /Auditoria/ })).toBeInTheDocument();
    });

    it('perfil sem permissoes nao ve nenhum atalho', async () => {
      renderDashboard(COMUM, { 'GET /dashboard/summary': { status: 200, body: {} } });

      await heading('Dashboard');
      expect(screen.queryByRole('heading', { name: 'Atalhos' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Usuários/ })).not.toBeInTheDocument();
    });

    it('o atalho de Usuarios abre a area de usuarios', async () => {
      renderDashboard(GESTOR, {
        'GET /users': { status: 200, body: { items: [], total: 0, page: 1, limit: 20 } },
        'GET /users/assignable-roles': { status: 200, body: ['OPERADOR', 'USUARIO'] },
      });

      const atalhos = within(await shortcutsSection());
      await userEvent.click(atalhos.getByRole('link', { name: /Usuários/ }));

      expect(await heading('Usuários')).toBeInTheDocument();
    });
  });
});
