import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type {
  FinanceReportSummary,
  FinancialEntry,
  FinancialEntryPage,
  RoleName,
  User,
} from '../../api/client';
import { AuthProvider } from '../../auth/AuthContext';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Handler = Reply | ((init: RequestInit | undefined) => Reply | Promise<Reply>);

/** URLs completas chamadas, para conferir a query string do recorte. */
let urls: string[] = [];

/**
 * Substitui o `fetch` por respostas indexadas por "METODO /caminho".
 *
 * A chave ignora a query string, mas as URLs completas ficam em `urls`: e la que
 * se confere se o recorte foi parar na requisicao.
 */
function mockApi(routes: Record<string, Handler>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(url);
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) {
      throw new TypeError(`fetch nao mockado: ${key}`);
    }
    const reply = typeof handler === 'function' ? await handler(init) : handler;
    const headers = { 'Content-Type': 'application/json', ...reply.headers };
    return reply.body === undefined
      ? new Response(null, { status: reply.status })
      : new Response(
          reply.body instanceof Blob ? reply.body : JSON.stringify(reply.body),
          { status: reply.status, headers },
        );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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

const SO_LEITURA = makeUser('leitor', 'OPERADOR', ['finance:read']);
const SEM_ACESSO = makeUser('comum', 'USUARIO', []);

/**
 * Resumo de referencia.
 *
 * Os numeros sao INCOERENTES de proposito: 1000 - 400 nao da 7777,77, e as somas
 * dos agrupamentos nao fecham com os totais. E assim que se prova que a tela
 * apenas exibe o que o backend mandou, em vez de calcular por conta propria -
 * qualquer conta feita no cliente mudaria esses valores.
 */
const RESUMO: FinanceReportSummary = {
  filtros: { de: '2026-01-01', ate: '2026-01-31', status: null, tipo: null, categoria: null },
  totalRegistros: 7,
  totalReceitas: 1000,
  totalDespesas: 400,
  saldo: 7777.77,
  porStatus: [
    { status: 'CANCELADO', quantidade: 1, valor: 99 },
    { status: 'PAGO', quantidade: 2, valor: 1234.56 },
    { status: 'PENDENTE', quantidade: 4, valor: 10 },
  ],
  porTipo: [
    { tipo: 'DESPESA', quantidade: 3, valor: 400 },
    { tipo: 'RECEITA', quantidade: 4, valor: 1000 },
  ],
  porCategoria: [
    { categoria: 'Insumos', quantidade: 2, valor: 321.45 },
    { categoria: 'Vendas', quantidade: 5, valor: 1000 },
  ],
};

const VAZIO: FinanceReportSummary = {
  ...RESUMO,
  totalRegistros: 0,
  totalReceitas: 0,
  totalDespesas: 0,
  saldo: 0,
  porStatus: [],
  porTipo: [],
  porCategoria: [],
};

const entry = (overrides: Partial<FinancialEntry> = {}): FinancialEntry => ({
  id: 'entry-1',
  tipo: 'DESPESA',
  descricao: 'Compra de insumos',
  valor: 1500.5,
  data: '2026-01-10',
  categoria: 'Insumos',
  status: 'PENDENTE',
  observacao: null,
  criadoPorId: 'leitor',
  criadoPor: { id: 'leitor', nome: 'Pessoa leitor', email: 'leitor@vasta.test' },
  createdAt: '2026-01-10T12:00:00.000Z',
  updatedAt: '2026-01-10T12:00:00.000Z',
  ...overrides,
});

const entryPage = (items: FinancialEntry[]): FinancialEntryPage => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
});

function session(me: User, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'GET /auth/me': { status: 200, body: me },
    'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
    'GET /dashboard/summary': { status: 200, body: {} },
    ...extra,
  };
}

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

/** URLs chamadas para uma rota, so o caminho + query. */
const queriesTo = (caminho: string): string[] =>
  urls
    .map((url) => new URL(url))
    .filter((url) => url.pathname === caminho)
    .map((url) => `${url.pathname}${url.search}`);

/** Parametros do recorte da ultima chamada a uma rota. */
function lastParams(caminho: string): URLSearchParams {
  const chamadas = urls.map((url) => new URL(url)).filter((url) => url.pathname === caminho);
  expect(chamadas.length).toBeGreaterThan(0);
  return chamadas[chamadas.length - 1].searchParams;
}

/**
 * O cartao de total com o rotulo informado.
 *
 * Escopo necessario: "R$ 1.000,00" tambem aparece nas tabelas de agrupamento, e
 * "Lançamentos" e rotulo de cartao E cabecalho de coluna.
 */
function cardDe(rotulo: string): HTMLElement {
  const cartoes = screen
    .getAllByText(rotulo)
    .map((elemento) => elemento.closest('article.stat-card'))
    .filter((elemento): elemento is HTMLElement => elemento !== null);
  expect(cartoes).toHaveLength(1);
  return cartoes[0];
}

/** Preenche o periodo do formulario de relatorio. */
async function preencherPeriodo(de: string, ate: string): Promise<void> {
  const user = userEvent.setup();
  const campoDe = screen.getByLabelText(/^De/);
  const campoAte = screen.getByLabelText(/^Até/);
  await user.clear(campoDe);
  await user.type(campoDe, de);
  await user.clear(campoAte);
  await user.type(campoAte, ate);
}

const gerar = async (): Promise<void> => {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Gerar relatório' }));
};

const exportar = async (): Promise<void> => {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Exportar Excel' }));
};

/** Metodos de `URL` que este arquivo definiu e precisa remover depois. */
const definidosEmURL: string[] = [];

function definirEmURL(nome: string, implementacao: (...args: never[]) => unknown): void {
  Object.defineProperty(URL, nome, {
    value: vi.fn(implementacao),
    configurable: true,
    writable: true,
  });
  definidosEmURL.push(nome);
}

/** Captura os downloads disparados, que o jsdom nao implementa. */
function espionarDownload(): { cliques: { href: string; download: string }[]; revogados: string[] } {
  const cliques: { href: string; download: string }[] = [];
  const revogados: string[] = [];
  let contador = 0;

  // Define SO os dois metodos que faltam no jsdom. Trocar o global `URL`
  // inteiro levaria junto o construtor, do qual o roteador depende.
  definirEmURL('createObjectURL', () => `blob:fake/${++contador}`);
  definirEmURL('revokeObjectURL', (url: string) => {
    revogados.push(url);
  });

  // O clique num `<a download>` nao faz nada no jsdom; registra-se a intencao.
  // Lido com `Reflect.get` por dois motivos: guarda o valor ORIGINAL agora,
  // antes de o espiao entrar (buscar `prototype.click` depois acharia o proprio
  // espiao e entraria em recursao), e nao e a referencia nua a um metodo, que o
  // `unbound-method` recusaria.
  const clickOriginal = Reflect.get(HTMLAnchorElement.prototype, 'click');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (this.download) {
      cliques.push({ href: this.href, download: this.download });
      return;
    }
    clickOriginal.call(this);
  });

  return { cliques, revogados };
}

beforeEach(() => {
  urls = [];
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  while (definidosEmURL.length > 0) {
    const nome = definidosEmURL.pop();
    if (nome !== undefined) {
      Reflect.deleteProperty(URL, nome);
    }
  }
});

describe('acesso a tela de relatorios', () => {
  it('quem tem finance:read abre a tela', async () => {
    mockApi(session(SO_LEITURA));

    renderAt('/finance/relatorios');

    expect(
      await screen.findByRole('heading', { name: 'Relatórios do financeiro' }),
    ).toBeInTheDocument();
  });

  it('quem nao tem finance:read nao abre a tela nem chama o relatorio', async () => {
    mockApi(session(SEM_ACESSO));

    renderAt('/finance/relatorios');

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Relatórios do financeiro' })).toBeNull();
    });
    expect(queriesTo('/finance/reports/summary')).toHaveLength(0);
    expect(queriesTo('/finance/reports/export')).toHaveLength(0);
  });

  it('nao exige permissao de exportacao: o botao aparece so com finance:read', async () => {
    // Nao existe `finance:export` - exportar usa a mesma permissao de leitura.
    mockApi(session(SO_LEITURA));

    renderAt('/finance/relatorios');

    expect(await screen.findByRole('button', { name: 'Exportar Excel' })).toBeEnabled();
  });

  it('a tela nao consulta nada sozinha ao abrir', async () => {
    mockApi(session(SO_LEITURA));

    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });

    // O relatorio e sob demanda: so sai depois de o usuario pedir.
    expect(queriesTo('/finance/reports/summary')).toHaveLength(0);
  });
});

describe('resumo do periodo', () => {
  async function abrirComResumo(resumo: FinanceReportSummary = RESUMO): Promise<void> {
    mockApi(
      session(SO_LEITURA, { 'GET /finance/reports/summary': { status: 200, body: resumo } }),
    );
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2026-01-01', '2026-01-31');
    await gerar();
  }

  it('leva o periodo na requisicao', async () => {
    await abrirComResumo();

    await waitFor(() => {
      expect(queriesTo('/finance/reports/summary')).toHaveLength(1);
    });
    const params = lastParams('/finance/reports/summary');
    expect(params.get('de')).toBe('2026-01-01');
    expect(params.get('ate')).toBe('2026-01-31');
  });

  it('nao envia filtro vazio', async () => {
    await abrirComResumo();

    await waitFor(() => {
      expect(queriesTo('/finance/reports/summary')).toHaveLength(1);
    });
    const params = lastParams('/finance/reports/summary');
    // Enviar `status=` levaria um 400: o backend valida o formato.
    expect(params.has('status')).toBe(false);
    expect(params.has('tipo')).toBe(false);
    expect(params.has('categoria')).toBe(false);
  });

  it('leva os filtros preenchidos', async () => {
    mockApi(session(SO_LEITURA, { 'GET /finance/reports/summary': { status: 200, body: RESUMO } }));
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2026-01-01', '2026-01-31');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Tipo'), 'DESPESA');
    await user.selectOptions(screen.getByLabelText('Situação'), 'PAGO');
    await user.type(screen.getByLabelText('Categoria'), 'Insumos');
    await gerar();

    await waitFor(() => {
      expect(queriesTo('/finance/reports/summary')).toHaveLength(1);
    });
    const params = lastParams('/finance/reports/summary');
    expect(params.get('tipo')).toBe('DESPESA');
    expect(params.get('status')).toBe('PAGO');
    expect(params.get('categoria')).toBe('Insumos');
  });

  it('mostra exatamente os totais do backend, sem recalcular', async () => {
    await abrirComResumo();

    // Os numeros do RESUMO nao fecham entre si de proposito: 1000 - 400 nao da
    // 7777,77, e as somas dos agrupamentos nao batem com os totais. Se a tela
    // fizesse qualquer conta, estes valores seriam outros.
    await waitFor(() => {
      expect(within(cardDe('Saldo')).getByText('R$ 7.777,77')).toBeInTheDocument();
    });
    expect(within(cardDe('Receitas')).getByText('R$ 1.000,00')).toBeInTheDocument();
    expect(within(cardDe('Despesas')).getByText('R$ 400,00')).toBeInTheDocument();
    expect(within(cardDe('Lançamentos')).getByText('7')).toBeInTheDocument();
  });

  it('diz que a contagem inclui os cancelados', async () => {
    await abrirComResumo();

    await waitFor(() => {
      expect(within(cardDe('Lançamentos')).getByText('Inclui os cancelados')).toBeInTheDocument();
    });
  });

  it('mostra os tres agrupamentos com rotulos em portugues', async () => {
    await abrirComResumo();

    const porSituacao = (await screen.findByRole('heading', { name: 'Por situação' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(porSituacao).getByRole('cell', { name: 'Cancelado' })).toBeInTheDocument();
    expect(within(porSituacao).getByRole('cell', { name: 'Pago' })).toBeInTheDocument();
    expect(within(porSituacao).getByRole('cell', { name: 'Pendente' })).toBeInTheDocument();

    const porTipo = screen.getByRole('heading', { name: 'Por tipo' }).closest('section') as HTMLElement;
    expect(within(porTipo).getByRole('cell', { name: 'Receita' })).toBeInTheDocument();
    expect(within(porTipo).getByRole('cell', { name: 'Despesa' })).toBeInTheDocument();

    const porCategoria = screen
      .getByRole('heading', { name: 'Por categoria' })
      .closest('section') as HTMLElement;
    expect(within(porCategoria).getByRole('cell', { name: 'Insumos' })).toBeInTheDocument();
    expect(within(porCategoria).getByRole('cell', { name: 'Vendas' })).toBeInTheDocument();
  });

  it('explica que o cancelado nao entra no saldo', async () => {
    await abrirComResumo();

    expect(
      await screen.findByText(/cancelados aparecem aqui, mas não entram no saldo/i),
    ).toBeInTheDocument();
  });

  it('periodo sem lancamento informa isso, sem inventar numero', async () => {
    await abrirComResumo(VAZIO);

    expect(await screen.findByText(/Nenhum lançamento no período selecionado/i)).toBeInTheDocument();
    expect(screen.queryByText('Saldo')).toBeNull();
  });

  it('erro do servidor aparece como aviso, sem numero algum', async () => {
    mockApi(
      session(SO_LEITURA, {
        'GET /finance/reports/summary': { status: 500, body: { message: 'falhou' } },
      }),
    );
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2026-01-01', '2026-01-31');
    await gerar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Não foi possível gerar o relatório/i,
    );
    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it('mensagem do backend aparece quando o periodo e longo demais', async () => {
    mockApi(
      session(SO_LEITURA, {
        'GET /finance/reports/summary': {
          status: 400,
          body: { message: 'o periodo do relatorio nao pode passar de 366 dias' },
        },
      }),
    );
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2024-01-01', '2026-12-31');
    await gerar();

    // O limite nao e repetido no frontend: a mensagem vem de quem manda na regra.
    expect(await screen.findByRole('alert')).toHaveTextContent(/366 dias/);
  });
});

describe('validacao do periodo antes de chamar a API', () => {
  it('periodo incompleto nao gera requisicao', async () => {
    mockApi(session(SO_LEITURA, { 'GET /finance/reports/summary': { status: 200, body: RESUMO } }));
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/^Até/));
    await gerar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Informe as duas datas do período.');
    expect(queriesTo('/finance/reports/summary')).toHaveLength(0);
  });

  it('data final anterior a inicial nao gera requisicao', async () => {
    mockApi(session(SO_LEITURA, { 'GET /finance/reports/summary': { status: 200, body: RESUMO } }));
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2026-02-01', '2026-01-01');
    await gerar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A data final não pode ser anterior à inicial.',
    );
    expect(queriesTo('/finance/reports/summary')).toHaveLength(0);
  });

  it('a exportacao passa pela mesma validacao', async () => {
    mockApi(session(SO_LEITURA));
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2026-02-01', '2026-01-01');
    await exportar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A data final não pode ser anterior à inicial.',
    );
    expect(queriesTo('/finance/reports/export')).toHaveLength(0);
  });
});

describe('exportacao em planilha', () => {
  const PLANILHA = (): Blob =>
    new Blob(['conteudo-xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

  async function abrirEExportar(reply: Handler): Promise<ReturnType<typeof espionarDownload>> {
    const espiao = espionarDownload();
    mockApi(session(SO_LEITURA, { 'GET /finance/reports/export': reply }));
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2026-01-01', '2026-01-31');
    await exportar();
    return espiao;
  }

  it('baixa a planilha com o nome que o backend definiu', async () => {
    const { cliques } = await abrirEExportar({
      status: 200,
      body: PLANILHA(),
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':
          'attachment; filename="vastaflow-financeiro-2026-01-01-a-2026-01-31.xlsx"',
      },
    });

    await waitFor(() => {
      expect(cliques).toHaveLength(1);
    });
    expect(cliques[0].download).toBe('vastaflow-financeiro-2026-01-01-a-2026-01-31.xlsx');
    expect(await screen.findByRole('status')).toHaveTextContent(/baixada/i);
  });

  it('leva o recorte na requisicao da planilha', async () => {
    await abrirEExportar({ status: 200, body: PLANILHA() });

    await waitFor(() => {
      expect(queriesTo('/finance/reports/export')).toHaveLength(1);
    });
    const params = lastParams('/finance/reports/export');
    expect(params.get('de')).toBe('2026-01-01');
    expect(params.get('ate')).toBe('2026-01-31');
  });

  it('libera o endereco temporario do arquivo', async () => {
    const { cliques, revogados } = await abrirEExportar({ status: 200, body: PLANILHA() });

    await waitFor(() => {
      expect(cliques).toHaveLength(1);
    });
    // Sem revogar, cada exportacao deixaria a planilha presa na memoria da aba.
    await waitFor(() => {
      expect(revogados).toEqual([cliques[0].href]);
    });
  });

  it('409 vira mensagem que orienta reduzir o periodo', async () => {
    const { cliques } = await abrirEExportar({
      status: 409,
      body: { message: 'A exportacao esta limitada a 50000 lancamentos e o filtro atual tem 73000.' },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Reduza o período ou use mais filtros/i,
    );
    // Nada foi baixado: nenhum arquivo meio-escrito chega ao usuario.
    expect(cliques).toHaveLength(0);
  });

  it('403 vira mensagem de permissao, sem download', async () => {
    const { cliques } = await abrirEExportar({ status: 403, body: { message: 'Proibido' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/não tem permissão/i);
    expect(cliques).toHaveLength(0);
  });

  it('o nome do arquivo nao vaza categoria nem dado de negocio', async () => {
    const espiao = espionarDownload();
    mockApi(
      session(SO_LEITURA, { 'GET /finance/reports/export': { status: 200, body: PLANILHA() } }),
    );
    renderAt('/finance/relatorios');
    await screen.findByRole('heading', { name: 'Relatórios do financeiro' });
    await preencherPeriodo('2026-01-01', '2026-01-31');
    await userEvent.setup().type(screen.getByLabelText('Categoria'), 'Folha de pagamento');
    await exportar();

    await waitFor(() => {
      expect(espiao.cliques).toHaveLength(1);
    });
    // Sem `Content-Disposition`, vale o nome local - que leva so o periodo.
    expect(espiao.cliques[0].download).toBe('vastaflow-financeiro-2026-01-01-a-2026-01-31.xlsx');
    expect(espiao.cliques[0].download).not.toMatch(/folha/i);
  });
});

describe('filtros na listagem de lancamentos', () => {
  async function abrirListagem(items: FinancialEntry[] = [entry()]): Promise<void> {
    mockApi(
      session(SO_LEITURA, { 'GET /finance/entries': { status: 200, body: entryPage(items) } }),
    );
    renderAt('/finance');
    await screen.findByRole('heading', { name: 'Financeiro' });
  }

  it('a primeira consulta nao leva filtro nenhum', async () => {
    await abrirListagem();

    const params = lastParams('/finance/entries');
    expect(params.has('de')).toBe(false);
    expect(params.has('status')).toBe(false);
    expect(params.get('page')).toBe('1');
  });

  it('filtrar leva o recorte ao banco', async () => {
    await abrirListagem();
    const antes = queriesTo('/finance/entries').length;

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^De/), '2026-01-01');
    await user.selectOptions(screen.getByLabelText('Situação'), 'PENDENTE');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => {
      expect(queriesTo('/finance/entries').length).toBeGreaterThan(antes);
    });
    const params = lastParams('/finance/entries');
    expect(params.get('de')).toBe('2026-01-01');
    expect(params.get('status')).toBe('PENDENTE');
  });

  it('filtrar a partir de outra pagina volta para a primeira', async () => {
    // Tres paginas, para que a navegacao exista de verdade. Sem sair da pagina 1
    // o teste nao distinguiria "voltou para a primeira" de "nunca saiu dela".
    mockApi(
      session(SO_LEITURA, {
        'GET /finance/entries': {
          status: 200,
          body: { items: [entry()], total: 60, page: 1, limit: 20 },
        },
      }),
    );
    renderAt('/finance');
    await screen.findByRole('heading', { name: 'Financeiro' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Próxima' }));
    await waitFor(() => {
      expect(lastParams('/finance/entries').get('page')).toBe('2');
    });

    await user.type(screen.getByLabelText(/^De/), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => {
      expect(lastParams('/finance/entries').get('de')).toBe('2026-01-01');
    });
    // A pagina 2 do recorte anterior pode nem existir no novo: o resultado
    // apareceria vazio sem motivo visivel.
    expect(lastParams('/finance/entries').get('page')).toBe('1');
  });

  it('digitar na categoria nao dispara uma consulta por tecla', async () => {
    await abrirListagem();
    const antes = queriesTo('/finance/entries').length;

    await userEvent.setup().type(screen.getByLabelText('Categoria'), 'Insumos');

    // A consulta sai no "Filtrar", nao a cada tecla.
    expect(queriesTo('/finance/entries')).toHaveLength(antes);
  });

  it('limpar filtros volta a consultar sem recorte', async () => {
    await abrirListagem();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^De/), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() => {
      expect(lastParams('/finance/entries').get('de')).toBe('2026-01-01');
    });

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    await waitFor(() => {
      expect(lastParams('/finance/entries').has('de')).toBe(false);
    });
  });

  it('sem resultado no filtro, a mensagem diz que o filtro e a causa', async () => {
    mockApi(
      session(SO_LEITURA, {
        'GET /finance/entries': (init) => {
          void init;
          return { status: 200, body: entryPage([]) };
        },
      }),
    );
    renderAt('/finance');
    await screen.findByRole('heading', { name: 'Financeiro' });
    expect(await screen.findByText('Nenhum lançamento registrado ainda.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^De/), '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    expect(
      await screen.findByText('Nenhum lançamento corresponde aos filtros aplicados.'),
    ).toBeInTheDocument();
  });

  it('a listagem oferece o caminho para os relatorios', async () => {
    await abrirListagem();

    expect(screen.getByRole('link', { name: 'Relatórios' })).toHaveAttribute(
      'href',
      '/finance/relatorios',
    );
  });
});
