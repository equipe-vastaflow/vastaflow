import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { FinancialEntry, FinancialEntryPage, RoleName, User } from '../../api/client';
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

const ALL_FINANCE = ['finance:read', 'finance:create', 'finance:update', 'finance:status'];

function makeUser(id: string, role: RoleName, permissions: string[]): User {
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

const GESTOR = makeUser('gestor', 'GESTOR', ALL_FINANCE);
const SEM_ACESSO = makeUser('comum', 'USUARIO', []);
const SO_LEITURA = makeUser('leitor', 'OPERADOR', ['finance:read']);

function makeEntry(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: 'entry-1',
    tipo: 'DESPESA',
    descricao: 'Compra de insumos',
    valor: 1500.5,
    data: '2026-09-23',
    categoria: 'Insumos',
    status: 'PENDENTE',
    observacao: null,
    criadoPorId: 'gestor',
    criadoPor: { id: 'gestor', nome: 'Gabi Gestora', email: 'gestor@vasta.test' },
    createdAt: '2026-09-23T12:00:00.000Z',
    updatedAt: '2026-09-23T12:00:00.000Z',
    ...overrides,
  };
}

const RECEITA = makeEntry({
  id: 'entry-receita',
  tipo: 'RECEITA',
  descricao: 'Venda de servico',
  categoria: 'Servicos',
  valor: 2400,
});
const PAGO = makeEntry({ id: 'entry-pago', descricao: 'Aluguel', status: 'PAGO' });
const CANCELADO = makeEntry({ id: 'entry-cancelado', descricao: 'Pedido antigo', status: 'CANCELADO' });

const page = (items: FinancialEntry[], overrides: Partial<FinancialEntryPage> = {}): FinancialEntryPage => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  ...overrides,
});

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
    'GET /dashboard/summary': { status: 200, body: {} },
    ...extra,
  };
}

const rowOf = async (descricao: string): Promise<HTMLElement> => {
  const cell = await screen.findByRole('cell', { name: descricao });
  return cell.closest('tr') as HTMLElement;
};

/** Corpos enviados para uma rota, na ordem das chamadas. */
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, key: string): unknown[] =>
  fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(url as string).pathname}` ===
        key,
    )
    .map(([, init]) => JSON.parse(((init as RequestInit).body as string | undefined) ?? 'null') as unknown);

const callsTo = (fetchMock: ReturnType<typeof vi.fn>, key: string): number =>
  bodyOf(fetchMock, key).length;

describe('acesso a tela financeira', () => {
  it('usuario com finance:read visualiza a pagina', async () => {
    mockApi(session(SO_LEITURA, { 'GET /finance/entries': { status: 200, body: page([makeEntry()]) } }));

    renderAt('/finance');

    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeInTheDocument();
    expect(await rowOf('Compra de insumos')).toBeInTheDocument();
  });

  it('usuario sem finance:read nao acessa a pagina e nem chama a API', async () => {
    const fetchMock = mockApi(session(SEM_ACESSO));

    renderAt('/finance');

    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET /finance/entries')).toBe(0);
  });

  it('o link Financeiro so aparece no menu para quem tem finance:read', async () => {
    mockApi(session(SEM_ACESSO));
    renderAt('/dashboard');

    await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(screen.queryByRole('link', { name: 'Financeiro' })).not.toBeInTheDocument();
  });

  it('o link Financeiro aparece para quem tem finance:read', async () => {
    mockApi(session(SO_LEITURA));
    renderAt('/dashboard');

    expect(await screen.findByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
  });
});

describe('listagem', () => {
  it('mostra tipo, descricao, categoria, valor, data e status', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries': { status: 200, body: page([makeEntry(), RECEITA]) } }));

    renderAt('/finance');

    const despesa = await rowOf('Compra de insumos');
    expect(within(despesa).getByText('Despesa')).toBeInTheDocument();
    expect(within(despesa).getByText('Insumos')).toBeInTheDocument();
    expect(within(despesa).getByText('Pendente')).toBeInTheDocument();
    // Moeda brasileira, com separador de milhar e duas casas.
    expect(within(despesa).getByText(/1\.500,50/)).toBeInTheDocument();
    expect(within(despesa).getByText(/^R\$/)).toBeInTheDocument();

    const receita = await rowOf('Venda de servico');
    expect(within(receita).getByText('Receita')).toBeInTheDocument();
    expect(within(receita).getByText(/2\.400,00/)).toBeInTheDocument();
  });

  it('mostra a data sem deslocar o dia por causa de fuso', async () => {
    mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 200, body: page([makeEntry({ data: '2026-01-01' })]) },
      }),
    );

    renderAt('/finance');

    const row = await rowOf('Compra de insumos');
    expect(within(row).getByText('01/01/2026')).toBeInTheDocument();
    expect(within(row).queryByText('31/12/2025')).not.toBeInTheDocument();
  });

  it('mostra o carregamento enquanto a API nao responde', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries': () => new Promise<Reply>(() => undefined) }));

    renderAt('/finance');

    expect(await screen.findByText('Carregando lançamentos…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('mostra o estado vazio', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries': { status: 200, body: page([]) } }));

    renderAt('/finance');

    expect(await screen.findByText('Nenhum lançamento registrado ainda.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('mostra o erro da API e permite tentar de novo', async () => {
    let calls = 0;
    mockApi(
      session(GESTOR, {
        'GET /finance/entries': () =>
          ++calls === 1
            ? { status: 500, body: { message: 'Erro interno do servidor' } }
            : { status: 200, body: page([makeEntry()]) },
      }),
    );
    const user = userEvent.setup();

    renderAt('/finance');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Não foi possível carregar os lançamentos/,
    );
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await rowOf('Compra de insumos')).toBeInTheDocument();
  });

  it('mostra mensagem de permissao insuficiente quando a API responde 403', async () => {
    mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 403, body: { message: 'Voce nao tem permissao' } },
      }),
    );

    renderAt('/finance');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Você não tem permissão para esta ação.',
    );
  });

  it('usa a paginacao do backend e pede a pagina seguinte', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 200, body: page([makeEntry()], { total: 45, limit: 20 }) },
      }),
    );
    const user = userEvent.setup();

    renderAt('/finance');

    expect(await screen.findByText(/Página 1 de 3 · 45 lançamentos/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes('page=2') && url.includes('/finance/entries'))).toBe(true);
    });
  });
});

describe('acoes por permissao e status', () => {
  it('sem finance:create nao oferece novo lancamento', async () => {
    mockApi(session(SO_LEITURA, { 'GET /finance/entries': { status: 200, body: page([makeEntry()]) } }));

    renderAt('/finance');

    await rowOf('Compra de insumos');
    expect(screen.queryByRole('link', { name: 'Novo lançamento' })).not.toBeInTheDocument();
  });

  it('sem finance:update e finance:status oferece apenas Ver', async () => {
    mockApi(session(SO_LEITURA, { 'GET /finance/entries': { status: 200, body: page([makeEntry()]) } }));

    renderAt('/finance');

    const row = await rowOf('Compra de insumos');
    expect(within(row).getByRole('link', { name: 'Ver' })).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Marcar como pago' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('PENDENTE oferece marcar como pago e cancelar', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries': { status: 200, body: page([makeEntry()]) } }));

    renderAt('/finance');

    const row = await rowOf('Compra de insumos');
    expect(within(row).getByRole('link', { name: 'Editar' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Marcar como pago' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('PAGO oferece apenas cancelar - nao existe volta para pendente', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries': { status: 200, body: page([PAGO]) } }));

    renderAt('/finance');

    const row = await rowOf('Aluguel');
    expect(within(row).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Marcar como pago' })).not.toBeInTheDocument();
    // PAGO ainda tem campos descritivos editaveis.
    expect(within(row).getByRole('link', { name: 'Editar' })).toBeInTheDocument();
  });

  it('CANCELADO nao oferece transicao nem edicao', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries': { status: 200, body: page([CANCELADO]) } }));

    renderAt('/finance');

    const row = await rowOf('Pedido antigo');
    expect(within(row).getByRole('link', { name: 'Ver' })).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Marcar como pago' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });
});

describe('mudanca de status', () => {
  /** Abre o dialogo de confirmacao da acao pedida na linha informada. */
  async function openDialog(descricao: string, acao: string): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    const row = await rowOf(descricao);
    await user.click(within(row).getByRole('button', { name: acao }));
    return user;
  }

  it('PENDENTE -> PAGO envia o status apos confirmacao', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 200, body: page([makeEntry()]) },
        'PATCH /finance/entries/entry-1/status': {
          status: 200,
          body: makeEntry({ status: 'PAGO' }),
        },
      }),
    );

    renderAt('/finance');
    const user = await openDialog('Compra de insumos', 'Marcar como pago');

    expect(screen.getByRole('dialog')).toHaveTextContent('Marcar como pago?');
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, 'PATCH /finance/entries/entry-1/status')).toEqual([
        { status: 'PAGO' },
      ]);
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/agora está como Pago/);
  });

  it('PENDENTE -> CANCELADO pede confirmacao explicita e avisa que nao volta atras', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 200, body: page([makeEntry()]) },
        'PATCH /finance/entries/entry-1/status': {
          status: 200,
          body: makeEntry({ status: 'CANCELADO' }),
        },
      }),
    );

    renderAt('/finance');
    const user = await openDialog('Compra de insumos', 'Cancelar');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Cancelar lançamento?');
    expect(dialog).toHaveTextContent(/não poderá ser desfeita/);
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cancelamento' }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, 'PATCH /finance/entries/entry-1/status')).toEqual([
        { status: 'CANCELADO' },
      ]);
    });
  });

  it('PAGO -> CANCELADO envia o status', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 200, body: page([PAGO]) },
        'PATCH /finance/entries/entry-pago/status': {
          status: 200,
          body: makeEntry({ id: 'entry-pago', descricao: 'Aluguel', status: 'CANCELADO' }),
        },
      }),
    );

    renderAt('/finance');
    const user = await openDialog('Aluguel', 'Cancelar');
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, 'PATCH /finance/entries/entry-pago/status')).toEqual([
        { status: 'CANCELADO' },
      ]);
    });
  });

  it('voltar fecha o dialogo sem alterar nada', async () => {
    const fetchMock = mockApi(
      session(GESTOR, { 'GET /finance/entries': { status: 200, body: page([makeEntry()]) } }),
    );

    renderAt('/finance');
    const user = await openDialog('Compra de insumos', 'Cancelar');
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, 'PATCH /finance/entries/entry-1/status')).toBe(0);
  });

  it('409 vira mensagem compreensivel, sem mostrar o texto tecnico do backend', async () => {
    mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 200, body: page([makeEntry()]) },
        'PATCH /finance/entries/entry-1/status': {
          status: 409,
          body: { message: 'Transicao PAGO -> PENDENTE nao permitida. Destinos validos: CANCELADO' },
        },
      }),
    );

    renderAt('/finance');
    const user = await openDialog('Compra de insumos', 'Marcar como pago');
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Este lançamento já mudou de situação.');
    expect(alerta).not.toHaveTextContent('Transicao');
    expect(alerta).not.toHaveTextContent('Conflict');
  });

  it('recarrega a listagem depois de mudar o status', async () => {
    let listas = 0;
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries': () => {
          listas += 1;
          return {
            status: 200,
            body: page([makeEntry({ status: listas === 1 ? 'PENDENTE' : 'PAGO' })]),
          };
        },
        'PATCH /finance/entries/entry-1/status': { status: 200, body: makeEntry({ status: 'PAGO' }) },
      }),
    );

    renderAt('/finance');
    const user = await openDialog('Compra de insumos', 'Marcar como pago');
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));

    await waitFor(() => {
      expect(callsTo(fetchMock, 'GET /finance/entries')).toBe(2);
    });
    expect(within(await rowOf('Compra de insumos')).getByText('Pago')).toBeInTheDocument();
  });

  it('um clique repetido nao dispara uma segunda requisicao de status', async () => {
    let resolver: ((reply: Reply) => void) | undefined;
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries': { status: 200, body: page([makeEntry()]) },
        'PATCH /finance/entries/entry-1/status': () =>
          new Promise<Reply>((resolve) => {
            resolver = resolve;
          }),
      }),
    );

    renderAt('/finance');
    const user = await openDialog('Compra de insumos', 'Marcar como pago');
    const confirmar = screen.getByRole('button', { name: 'Confirmar pagamento' });
    await user.click(confirmar);

    // Enquanto a requisicao nao volta, o botao fica desabilitado.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Aguarde…' })).toBeDisabled();
    });
    await user.click(screen.getByRole('button', { name: 'Aguarde…' }));

    expect(callsTo(fetchMock, 'PATCH /finance/entries/entry-1/status')).toBe(1);
    resolver?.({ status: 200, body: makeEntry({ status: 'PAGO' }) });
  });
});

describe('criacao', () => {
  const novo = (extra: Record<string, Handler> = {}): Record<string, Handler> =>
    session(GESTOR, { 'GET /finance/entries': { status: 200, body: page([]) }, ...extra });

  async function preencher(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.selectOptions(screen.getByLabelText('Tipo'), 'DESPESA');
    await user.type(screen.getByLabelText('Descrição'), 'Compra de insumos');
    await user.type(screen.getByLabelText('Valor (R$)'), '1500,50');
    await user.type(screen.getByLabelText('Data'), '2026-09-23');
    await user.type(screen.getByLabelText('Categoria'), 'Insumos');
  }

  it('envia o lancamento sem status nem autor', async () => {
    const fetchMock = mockApi(novo({ 'POST /finance/entries': { status: 201, body: makeEntry() } }));
    const user = userEvent.setup();

    renderAt('/finance/novo');
    await screen.findByRole('heading', { name: 'Novo lançamento' });
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Criar lançamento' }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, 'POST /finance/entries')).toEqual([
        {
          tipo: 'DESPESA',
          descricao: 'Compra de insumos',
          valor: 1500.5,
          data: '2026-09-23',
          categoria: 'Insumos',
        },
      ]);
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/criado com sucesso/);
  });

  it('nao permite escolher status nem quem criou', async () => {
    mockApi(novo());

    renderAt('/finance/novo');

    await screen.findByLabelText('Tipo');
    expect(screen.queryByLabelText(/Status/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Criado por/)).not.toBeInTheDocument();
  });

  it('mantem o envio bloqueado enquanto faltam campos obrigatorios', async () => {
    mockApi(novo());
    const user = userEvent.setup();

    renderAt('/finance/novo');
    await screen.findByLabelText('Tipo');

    expect(screen.getByRole('button', { name: 'Criar lançamento' })).toBeDisabled();
    await preencher(user);
    expect(screen.getByRole('button', { name: 'Criar lançamento' })).toBeEnabled();
  });

  it.each([
    ['0', 'zero'],
    ['12,345', 'tres casas decimais'],
    ['abc', 'texto'],
    ['-10', 'negativo'],
  ])('recusa o valor %j (%s) antes de enviar', async (valor) => {
    const fetchMock = mockApi(novo());
    const user = userEvent.setup();

    renderAt('/finance/novo');
    await screen.findByLabelText('Tipo');
    await user.selectOptions(screen.getByLabelText('Tipo'), 'RECEITA');
    await user.type(screen.getByLabelText('Descrição'), 'Teste');
    await user.type(screen.getByLabelText('Categoria'), 'Teste');
    await user.type(screen.getByLabelText('Data'), '2026-09-23');
    await user.type(screen.getByLabelText('Valor (R$)'), valor);

    expect(screen.getByRole('button', { name: 'Criar lançamento' })).toBeDisabled();
    expect(await screen.findByText(/Informe um valor maior que zero/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /finance/entries')).toBe(0);
  });

  it('mostra o erro de validacao devolvido pelo backend', async () => {
    mockApi(
      novo({
        'POST /finance/entries': {
          status: 400,
          body: { message: ['valor deve ser maior que zero'] },
        },
      }),
    );
    const user = userEvent.setup();

    renderAt('/finance/novo');
    await screen.findByLabelText('Tipo');
    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Criar lançamento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('valor deve ser maior que zero');
  });

  it('sem finance:create a rota de criacao e negada', async () => {
    const fetchMock = mockApi(session(SO_LEITURA));

    renderAt('/finance/novo');

    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST /finance/entries')).toBe(0);
  });
});

describe('edicao', () => {
  it('PENDENTE permite editar todos os campos', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries/entry-1': { status: 200, body: makeEntry() } }));

    renderAt('/finance/entry-1/editar');

    expect(await screen.findByLabelText('Tipo')).toBeEnabled();
    expect(screen.getByLabelText('Valor (R$)')).toBeEnabled();
    expect(screen.getByLabelText('Data')).toBeEnabled();
    expect(screen.getByLabelText('Descrição')).toBeEnabled();
    expect(screen.getByLabelText('Categoria')).toBeEnabled();
    expect(screen.getByLabelText('Observação (opcional)')).toBeEnabled();
  });

  it('envia somente os campos alterados', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries/entry-1': { status: 200, body: makeEntry() },
        'PATCH /finance/entries/entry-1': {
          status: 200,
          body: makeEntry({ descricao: 'Compra de insumos revisada' }),
        },
      }),
    );
    const user = userEvent.setup();

    renderAt('/finance/entry-1/editar');
    const descricao = await screen.findByLabelText('Descrição');
    await user.clear(descricao);
    await user.type(descricao, 'Compra revisada');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => {
      expect(bodyOf(fetchMock, 'PATCH /finance/entries/entry-1')).toEqual([
        { descricao: 'Compra revisada' },
      ]);
    });
  });

  it('PAGO bloqueia tipo, valor e data', async () => {
    mockApi(session(GESTOR, { 'GET /finance/entries/entry-pago': { status: 200, body: PAGO } }));

    renderAt('/finance/entry-pago/editar');

    expect(await screen.findByLabelText('Tipo')).toBeDisabled();
    expect(screen.getByLabelText('Valor (R$)')).toBeDisabled();
    expect(screen.getByLabelText('Data')).toBeDisabled();
    // O motivo do bloqueio fica escrito, nao apenas subentendido.
    expect(
      screen.getAllByText('Não pode ser alterado depois que o lançamento foi pago.').length,
    ).toBeGreaterThan(0);
  });

  it('PAGO permite editar descricao, categoria e observacao', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries/entry-pago': { status: 200, body: PAGO },
        'PATCH /finance/entries/entry-pago': { status: 200, body: PAGO },
      }),
    );
    const user = userEvent.setup();

    renderAt('/finance/entry-pago/editar');

    const categoria = await screen.findByLabelText('Categoria');
    expect(categoria).toBeEnabled();
    expect(screen.getByLabelText('Descrição')).toBeEnabled();
    expect(screen.getByLabelText('Observação (opcional)')).toBeEnabled();

    await user.clear(categoria);
    await user.type(categoria, 'Ocupacao');
    await user.type(screen.getByLabelText('Observação (opcional)'), 'Contrato renovado');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    // Nenhum campo congelado e enviado, mesmo estando no formulario.
    await waitFor(() => {
      expect(bodyOf(fetchMock, 'PATCH /finance/entries/entry-pago')).toEqual([
        { categoria: 'Ocupacao', observacao: 'Contrato renovado' },
      ]);
    });
  });

  it('CANCELADO nao abre formulario editavel', async () => {
    mockApi(
      session(GESTOR, { 'GET /finance/entries/entry-cancelado': { status: 200, body: CANCELADO } }),
    );

    renderAt('/finance/entry-cancelado/editar');

    expect(await screen.findByRole('alert')).toHaveTextContent(/não pode mais ser editado/);
    expect(screen.queryByLabelText('Descrição')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument();
  });

  it('409 na edicao vira mensagem compreensivel', async () => {
    mockApi(
      session(GESTOR, {
        'GET /finance/entries/entry-1': { status: 200, body: makeEntry() },
        'PATCH /finance/entries/entry-1': {
          status: 409,
          body: { message: 'Lancamento PAGO nao permite alterar: valor, data' },
        },
      }),
    );
    const user = userEvent.setup();

    renderAt('/finance/entry-1/editar');
    const descricao = await screen.findByLabelText('Descrição');
    await user.clear(descricao);
    await user.type(descricao, 'Outra descricao');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/já mudou de situação/);
    expect(alerta).not.toHaveTextContent('Conflict');
  });

  it('sem finance:update a rota de edicao e negada', async () => {
    mockApi(session(SO_LEITURA));

    renderAt('/finance/entry-1/editar');

    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
  });
});

describe('detalhes', () => {
  it('mostra os campos do lancamento e o autor ja resolvido pela API', async () => {
    const fetchMock = mockApi(
      session(GESTOR, {
        'GET /finance/entries/entry-1': {
          status: 200,
          body: makeEntry({ observacao: 'Combinado para o dia 30' }),
        },
      }),
    );

    renderAt('/finance/entry-1');

    expect(await screen.findByRole('heading', { name: 'Compra de insumos' })).toBeInTheDocument();
    expect(screen.getByText('Insumos')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText('23/09/2026')).toBeInTheDocument();
    expect(screen.getByText('Combinado para o dia 30')).toBeInTheDocument();
    expect(screen.getByText('Gabi Gestora')).toBeInTheDocument();
    // Sem N+1: o autor vem na propria resposta, nenhuma busca de usuario.
    expect(callsTo(fetchMock, 'GET /users/gestor')).toBe(0);
  });

  it('lancamento inexistente mostra mensagem propria do financeiro', async () => {
    mockApi(
      session(GESTOR, {
        'GET /finance/entries/sumido': { status: 404, body: { message: 'Lancamento nao encontrado' } },
      }),
    );

    renderAt('/finance/sumido');

    expect(await screen.findByRole('alert')).toHaveTextContent('Lançamento não encontrado.');
  });

  it('CANCELADO continua consultavel, sem oferecer edicao', async () => {
    mockApi(
      session(GESTOR, { 'GET /finance/entries/entry-cancelado': { status: 200, body: CANCELADO } }),
    );

    renderAt('/finance/entry-cancelado');

    expect(await screen.findByRole('heading', { name: 'Pedido antigo' })).toBeInTheDocument();
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
  });
});
