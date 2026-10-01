import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { RoleName, User, UserPage } from '../../api/client';
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

function makeUser(id: string, role: RoleName, overrides: Partial<User> = {}): User {
  return {
    id,
    nome: `Pessoa ${id}`,
    email: `${id}@vasta.test`,
    role,
    permissions: [],
    ativo: true,
    createdAt: '2026-03-10T12:00:00.000Z',
    updatedAt: '2026-03-10T12:00:00.000Z',
    ...overrides,
  };
}

const ALL_USERS_PERMISSIONS = [
  'users:read',
  'users:create',
  'users:update',
  'users:status',
  'users:role',
];
const GESTOR = makeUser('gestor', 'GESTOR', { nome: 'Gabi Gestora', permissions: ALL_USERS_PERMISSIONS });
const ADMIN = makeUser('admin', 'ADMIN', { nome: 'Ana Admin' });
const COMUM = makeUser('comum', 'USUARIO', { nome: 'Caio Comum' });
const INATIVO = makeUser('inativo', 'OPERADOR', { nome: 'Olga Inativa', ativo: false });

const page = (items: User[]): UserPage => ({ items, total: items.length, page: 1, limit: 20 });

function renderAt(path: string): void {
  localStorage.setItem(
    'vastaflow.session',
    JSON.stringify({ token: 'jwt-guardado', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Rotas padrao de uma sessao do `me` informado. */
function session(me: User, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'GET /auth/me': { status: 200, body: me },
    // O contador do menu consulta isto em toda pagina autenticada.
    'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
    // O dashboard e a pagina inicial destes testes; os indicadores em si tem
    // cobertura propria em pages/dashboard/dashboard.test.tsx.
    'GET /dashboard/summary': { status: 200, body: {} },
    'GET /users/assignable-roles': {
      status: 200,
      body: me.role === 'ADMIN' ? ['ADMIN', 'GESTOR', 'OPERADOR', 'USUARIO'] : ['OPERADOR', 'USUARIO'],
    },
    // O detalhe do usuario carrega a secao de vinculos externos; ela tem
    // cobertura propria em pages/users/external-identities.test.tsx.
    'GET /users/admin/external-identities': { status: 200, body: [] },
    'GET /users/admin/external-identities/link-requests': { status: 200, body: [] },
    ...extra,
  };
}

const rowOf = async (nome: string): Promise<HTMLElement> => {
  const cell = await screen.findByRole('cell', { name: nome });
  return cell.closest('tr') as HTMLElement;
};

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, key: string): unknown[] =>
  fetchMock.mock.calls
    .filter(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(url as string).pathname}` === key)
    .map(([, init]) => JSON.parse(((init as RequestInit).body as string | undefined) ?? 'null') as unknown);

describe('lista de usuarios', () => {
  it('renderiza nome, e-mail, perfil, status e data de criacao', async () => {
    mockApi(session(GESTOR, { 'GET /users': { status: 200, body: page([COMUM, INATIVO]) } }));

    renderAt('/users');

    const row = await rowOf('Caio Comum');
    expect(within(row).getByText('comum@vasta.test')).toBeInTheDocument();
    expect(within(row).getByText('Usuário')).toBeInTheDocument();
    expect(within(row).getByText('Ativo')).toBeInTheDocument();
    expect(within(row).getByText('10/03/2026')).toBeInTheDocument();
    expect(within(await rowOf('Olga Inativa')).getByText('Inativo')).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 1 · 2 usuários/)).toBeInTheDocument();
  });

  it('mostra o carregamento enquanto a API nao responde', async () => {
    mockApi(session(GESTOR, { 'GET /users': () => new Promise<Reply>(() => undefined) }));

    renderAt('/users');

    expect(await screen.findByText('Carregando usuários…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('mostra o estado vazio', async () => {
    mockApi(session(GESTOR, { 'GET /users': { status: 200, body: page([]) } }));

    renderAt('/users');

    expect(await screen.findByText('Nenhum usuário encontrado.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('mostra o erro e permite tentar de novo', async () => {
    let calls = 0;
    mockApi(
      session(GESTOR, {
        'GET /users': () =>
          ++calls === 1 ? { status: 500, body: { message: 'Erro interno do servidor' } } : { status: 200, body: page([COMUM]) },
      }),
    );
    const user = userEvent.setup();

    renderAt('/users');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar os usuários');
    await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    expect(await rowOf('Caio Comum')).toBeInTheDocument();
  });

  it('sessao recusada (401) durante a consulta leva ao login', async () => {
    mockApi(
      session(GESTOR, {
        'GET /users': { status: 401, body: { message: 'Token de acesso invalido ou expirado' } },
        'POST /auth/logout': { status: 401 },
      }),
    );

    renderAt('/users');

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });
});

describe('acoes condicionadas por permissao', () => {
  it('GESTOR gerencia quem esta abaixo, mas nao ADMIN nem o proprio status/perfil', async () => {
    mockApi(session(GESTOR, { 'GET /users': { status: 200, body: page([ADMIN, GESTOR, COMUM, INATIVO]) } }));

    renderAt('/users');

    const comum = await rowOf('Caio Comum');
    expect(within(comum).getByRole('link', { name: 'Ver' })).toBeInTheDocument();
    expect(within(comum).getByRole('link', { name: 'Editar' })).toBeInTheDocument();
    expect(within(comum).getByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    expect(within(comum).getByRole('button', { name: 'Alterar perfil' })).toBeInTheDocument();
    expect(within(await rowOf('Olga Inativa')).getByRole('button', { name: 'Ativar' })).toBeInTheDocument();

    const admin = await rowOf('Ana Admin');
    expect(within(admin).getByRole('link', { name: 'Ver' })).toBeInTheDocument();
    expect(within(admin).queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(admin).queryByRole('button')).not.toBeInTheDocument();

    const self = await rowOf('Gabi Gestora');
    expect(within(self).getByRole('link', { name: 'Editar' })).toBeInTheDocument();
    expect(within(self).queryByRole('button')).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Novo usuário' })).toBeInTheDocument();
  });

  it('quem so tem users:read apenas visualiza', async () => {
    const leitor = makeUser('leitor', 'OPERADOR', { nome: 'Lia Leitora', permissions: ['users:read'] });
    mockApi(
      session(leitor, {
        'GET /users/assignable-roles': { status: 200, body: [] },
        'GET /users': { status: 200, body: page([COMUM]) },
      }),
    );

    renderAt('/users');

    const row = await rowOf('Caio Comum');
    expect(within(row).getByRole('link', { name: 'Ver' })).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Novo usuário' })).not.toBeInTheDocument();
  });

  it('sem users:read nao ha navegacao para Usuarios no dashboard', async () => {
    const semAcesso = makeUser('sem', 'USUARIO', { nome: 'Sem Acesso' });
    mockApi(session(semAcesso));

    renderAt('/dashboard');
    expect(await screen.findByText(/Status da sessão/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();
  });

  it('dashboard mostra a navegacao Usuarios para quem pode listar', async () => {
    mockApi(session(GESTOR, { 'GET /users': { status: 200, body: page([COMUM]) } }));
    const user = userEvent.setup();

    renderAt('/dashboard');

    await user.click(await screen.findByRole('link', { name: 'Usuários' }));
    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
  });

  it('acesso direto a /users sem permissao mostra acesso negado e nao consulta usuarios', async () => {
    const semAcesso = makeUser('sem', 'USUARIO', { nome: 'Sem Acesso' });
    const fetchMock = mockApi(session(semAcesso));

    renderAt('/users');

    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'GET /users')).toHaveLength(0);
  });
});

describe('ativar/desativar e perfil', () => {
  it('pede confirmacao antes de desativar; cancelar nao chama a API', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /users': { status: 200, body: page([COMUM]) },
        'PATCH /users/comum/status': { status: 200, body: { ...COMUM, ativo: false } },
      }),
    );
    const user = userEvent.setup();

    renderAt('/users');
    await user.click(within(await rowOf('Caio Comum')).getByRole('button', { name: 'Desativar' }));

    const dialog = screen.getByRole('dialog', { name: 'Desativar usuário?' });
    expect(dialog).toHaveTextContent('Caio Comum');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bodyOf(fetchMock, 'PATCH /users/comum/status')).toHaveLength(0);
  });

  it('confirmando, desativa e mostra a mensagem de sucesso', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /users': { status: 200, body: page([COMUM]) },
        'PATCH /users/comum/status': { status: 200, body: { ...COMUM, ativo: false } },
      }),
    );
    const user = userEvent.setup();

    renderAt('/users');
    await user.click(within(await rowOf('Caio Comum')).getByRole('button', { name: 'Desativar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desativar' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Usuário Caio Comum desativado.');
    expect(bodyOf(fetchMock, 'PATCH /users/comum/status')).toEqual([{ ativo: false }]);
  });

  it('mostra a recusa do backend (ultimo ADMIN) em vez de fingir sucesso', async () => {
    const outroAdmin = makeUser('outro', 'ADMIN', { nome: 'Otto Admin' });
    mockApi(
      session(ADMIN, {
        'GET /users': { status: 200, body: page([outroAdmin]) },
        'PATCH /users/outro/status': {
          status: 409,
          body: { message: 'Operacao recusada: o sistema precisa manter ao menos um ADMIN ativo' },
        },
      }),
    );
    const user = userEvent.setup();

    renderAt('/users');
    await user.click(within(await rowOf('Otto Admin')).getByRole('button', { name: 'Desativar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desativar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ao menos um administrador ativo');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('altera o perfil escolhendo entre os perfis que o backend permite conceder', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /users': { status: 200, body: page([COMUM]) },
        'PATCH /users/comum/role': { status: 200, body: { ...COMUM, role: 'OPERADOR' } },
      }),
    );
    const user = userEvent.setup();

    renderAt('/users');
    await user.click(within(await rowOf('Caio Comum')).getByRole('button', { name: 'Alterar perfil' }));

    const dialog = screen.getByRole('dialog', { name: 'Alterar perfil' });
    const select = within(dialog).getByRole('combobox', { name: 'Novo perfil' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Selecione…',
      'Operador',
    ]);
    expect(within(dialog).getByRole('button', { name: 'Salvar perfil' })).toBeDisabled();

    await user.selectOptions(select, 'OPERADOR');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar perfil' }));

    expect(await screen.findByRole('status')).toHaveTextContent('alterado para Operador');
    expect(bodyOf(fetchMock, 'PATCH /users/comum/role')).toEqual([{ role: 'OPERADOR' }]);
  });
});

describe('formulario de usuario', () => {
  it('cria o usuario e volta para a lista com mensagem de sucesso', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'POST /users': (init) => ({
          status: 201,
          body: { ...COMUM, ...(JSON.parse(init?.body as string) as object), id: 'nova' },
        }),
        'GET /users': { status: 200, body: page([COMUM]) },
      }),
    );
    const user = userEvent.setup();

    renderAt('/users/novo');

    const submit = await screen.findByRole('button', { name: 'Criar usuário' });
    expect(screen.getByRole('combobox', { name: 'Perfil' })).toHaveValue('USUARIO');
    await user.type(screen.getByLabelText('Nome'), '  Nina Nova ');
    await user.type(screen.getByLabelText('E-mail'), 'nina@vasta.test');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Senha inicial'), 'Senha1234');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Perfil' }), 'OPERADOR');
    await user.click(submit);

    expect(await screen.findByRole('status')).toHaveTextContent('Usuário Nina Nova criado com sucesso.');
    expect(bodyOf(fetchMock, 'POST /users')).toEqual([
      { nome: 'Nina Nova', email: 'nina@vasta.test', senha: 'Senha1234', role: 'OPERADOR' },
    ]);
  });

  it('e-mail ja cadastrado mostra erro e mantem o formulario', async () => {
    mockApi(session(GESTOR, { 'POST /users': { status: 409, body: { message: 'E-mail ja cadastrado' } } }));
    const user = userEvent.setup();

    renderAt('/users/novo');
    await user.type(await screen.findByLabelText('Nome'), 'Nina');
    await user.type(screen.getByLabelText('E-mail'), 'comum@vasta.test');
    await user.type(screen.getByLabelText('Senha inicial'), 'Senha1234');
    await user.click(screen.getByRole('button', { name: 'Criar usuário' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um usuário com este e-mail.');
    expect(screen.getByLabelText('Nome')).toHaveValue('Nina');
  });

  it('edicao carrega os dados, envia so nome e e-mail e nao oferece senha nem perfil', async () => {
    let stored: User = COMUM;
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /users/comum': () => ({ status: 200, body: stored }),
        'PATCH /users/comum': (init) => {
          stored = { ...stored, ...(JSON.parse(init?.body as string) as Partial<User>) };
          return { status: 200, body: stored };
        },
      }),
    );
    const user = userEvent.setup();

    renderAt('/users/comum/editar');

    const nome = await screen.findByLabelText('Nome');
    expect(nome).toHaveValue('Caio Comum');
    expect(screen.queryByLabelText('Senha inicial')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Perfil' })).not.toBeInTheDocument();

    await user.clear(nome);
    await user.type(nome, 'Caio Editado');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Alterações salvas com sucesso.');
    expect(await screen.findByRole('heading', { name: 'Caio Editado' })).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'PATCH /users/comum')).toEqual([
      { nome: 'Caio Editado', email: 'comum@vasta.test' },
    ]);
  });

  it('nao oferece edicao de usuario fora do alcance do perfil', async () => {
    mockApi(session(GESTOR, { 'GET /users/admin': { status: 200, body: ADMIN } }));

    renderAt('/users/admin/editar');

    expect(await screen.findByRole('alert')).toHaveTextContent('Você não pode editar este usuário.');
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument();
  });

  it('visualizacao mostra os dados do usuario, sem acoes para quem nao pode editar', async () => {
    mockApi(session(GESTOR, { 'GET /users/admin': { status: 200, body: ADMIN } }));

    renderAt('/users/admin');

    expect(await screen.findByRole('heading', { name: 'Ana Admin' })).toBeInTheDocument();
    expect(screen.getByText('admin@vasta.test')).toBeInTheDocument();
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('usuario inexistente mostra erro na visualizacao', async () => {
    mockApi(session(GESTOR, { 'GET /users/x': { status: 404, body: { message: 'Usuario nao encontrado' } } }));

    renderAt('/users/x');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Usuário não encontrado.');
    });
  });
});
