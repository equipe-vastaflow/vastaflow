import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from './App';
import type { LoginResponse, User } from './api/client';
import { AuthProvider } from './auth/AuthContext';
import { formatRemaining } from './pages/format-remaining';

const USER: User = {
  id: 'user-1',
  nome: 'Maria Silva',
  email: 'maria@vasta.test',
  role: 'GESTOR',
  permissions: ['users:read'],
  ativo: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const LOGIN_RESPONSE: LoginResponse = {
  accessToken: 'jwt-de-teste',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: USER,
};

/** Resumo minimo: estes testes cobrem sessao e login, nao os indicadores. */
const SUMMARY = { usuarios: { total: 1, ativos: 1, inativos: 0 } };

type Route = { status: number; body?: unknown };

/** Substitui o `fetch` por respostas fixas, indexadas por "METODO /caminho". */
function mockApi(routes: Record<string, Route>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const route = routes[`${init?.method ?? 'GET'} ${path}`];
    if (!route) {
      return Promise.reject(new TypeError(`fetch nao mockado: ${init?.method ?? 'GET'} ${path}`));
    }
    return Promise.resolve(
      route.body === undefined
        ? new Response(null, { status: route.status })
        : new Response(JSON.stringify(route.body), {
            status: route.status,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function storeSession(expiresAt = Date.now() + 60 * 60 * 1000): void {
  localStorage.setItem('vastaflow.session', JSON.stringify({ token: 'jwt-guardado', expiresAt }));
}

const loginHeading = (): HTMLElement => screen.getByRole('heading', { name: 'VastaFlow' });

describe('rota protegida /dashboard', () => {
  it('usuario nao autenticado e enviado para /login e nunca ve o dashboard', async () => {
    const fetchMock = mockApi({});

    renderAt('/dashboard');

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(loginHeading()).toBeInTheDocument();
    expect(screen.queryByText(/Status da sessão/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nao mostra nada protegido enquanto valida o token guardado', () => {
    storeSession();
    // Resposta que nunca chega: o estado fica em "verificando".
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    renderAt('/dashboard');

    expect(screen.getByText('Verificando sessão…')).toBeInTheDocument();
    expect(screen.queryByText(/Status da sessão/)).not.toBeInTheDocument();
  });

  it('token guardado ja expirado e descartado sem nem consultar o servidor', async () => {
    storeSession(Date.now() - 1000);
    const fetchMock = mockApi({});

    renderAt('/dashboard');

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('vastaflow.session')).toBeNull();
  });

  it('token guardado recusado pelo servidor (401) volta para /login e limpa o armazenamento', async () => {
    storeSession();
    mockApi({ 'GET /auth/me': { status: 401, body: { message: 'Token de acesso invalido' } } });

    renderAt('/dashboard');

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(localStorage.getItem('vastaflow.session')).toBeNull();
  });

  it('token guardado valido mostra nome, perfil e status da sessao', async () => {
    storeSession();
    const fetchMock = mockApi({
      'GET /auth/me': { status: 200, body: USER },
      'GET /dashboard/summary': { status: 200, body: SUMMARY },
    });

    renderAt('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Maria Silva/)).toBeInTheDocument();
    expect(screen.getByText(/maria@vasta.test/)).toBeInTheDocument();
    expect(screen.getByText('Gestor')).toBeInTheDocument();
    expect(screen.getByText('(GESTOR)')).toBeInTheDocument();
    expect(screen.getByText(/Status da sessão: Ativa/)).toBeInTheDocument();
    expect(screen.getByText(/expira em/)).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-guardado' });
  });

  it('enderecos desconhecidos tambem exigem login', async () => {
    mockApi({});

    renderAt('/qualquer/coisa');

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });
});

describe('login', () => {
  it('credenciais validas levam ao dashboard e guardam a sessao', async () => {
    const fetchMock = mockApi({
      'POST /auth/login': { status: 200, body: LOGIN_RESPONSE },
      'GET /dashboard/summary': { status: 200, body: SUMMARY },
    });
    const user = userEvent.setup();

    renderAt('/login');
    await user.type(screen.getByLabelText('E-mail'), '  maria@vasta.test ');
    await user.type(screen.getByLabelText('Senha'), 'Senha1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Maria Silva/)).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'maria@vasta.test',
      senha: 'Senha1234',
    });
    const stored = JSON.parse(localStorage.getItem('vastaflow.session') ?? '{}') as {
      token?: string;
      expiresAt?: number;
    };
    expect(stored.token).toBe('jwt-de-teste');
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
    // O token e o unico dado guardado: nada de senha no armazenamento.
    expect(localStorage.getItem('vastaflow.session')).not.toContain('Senha1234');
  });

  it('senha incorreta (401) mostra erro e permanece em /login', async () => {
    mockApi({ 'POST /auth/login': { status: 401, body: { message: 'Credenciais invalidas' } } });
    const user = userEvent.setup();

    renderAt('/login');
    await user.type(screen.getByLabelText('E-mail'), 'maria@vasta.test');
    await user.type(screen.getByLabelText('Senha'), 'errada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(localStorage.getItem('vastaflow.session')).toBeNull();
  });

  it('usuario inativo (403) recebe mensagem propria', async () => {
    mockApi({ 'POST /auth/login': { status: 403, body: { message: 'Usuario inativo' } } });
    const user = userEvent.setup();

    renderAt('/login');
    await user.type(screen.getByLabelText('E-mail'), 'maria@vasta.test');
    await user.type(screen.getByLabelText('Senha'), 'Senha1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Este usuário está inativo');
  });

  it('servidor fora do ar mostra erro de conexao', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const user = userEvent.setup();

    renderAt('/login');
    await user.type(screen.getByLabelText('E-mail'), 'maria@vasta.test');
    await user.type(screen.getByLabelText('Senha'), 'Senha1234');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar');
  });

  it('quem ja esta autenticado nao ve o formulario de login', async () => {
    storeSession();
    mockApi({
      'GET /auth/me': { status: 200, body: USER },
      'GET /dashboard/summary': { status: 200, body: SUMMARY },
    });

    renderAt('/login');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('logout', () => {
  it('Sair encerra a sessao, avisa o servidor e bloqueia o dashboard de novo', async () => {
    storeSession();
    const fetchMock = mockApi({
      'GET /auth/me': { status: 200, body: USER },
      'POST /auth/logout': { status: 204 },
    });
    const user = userEvent.setup();

    renderAt('/dashboard');
    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(localStorage.getItem('vastaflow.session')).toBeNull();
    await waitFor(() => {
      const logoutCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/logout'));
      expect(logoutCall).toBeDefined();
      expect((logoutCall?.[1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer jwt-guardado',
      });
    });
  });

  it('encerra a sessao local mesmo se o servidor falhar', async () => {
    storeSession();
    mockApi({ 'GET /auth/me': { status: 200, body: USER } }); // logout nao mockado => erro de rede
    const user = userEvent.setup();

    renderAt('/dashboard');
    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(localStorage.getItem('vastaflow.session')).toBeNull();
  });
});

describe('formatRemaining', () => {
  it.each([
    [0, '00:00'],
    [-5000, '00:00'],
    [59_000, '00:59'],
    [61_000, '01:01'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
  ])('%i ms => %s', (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});
