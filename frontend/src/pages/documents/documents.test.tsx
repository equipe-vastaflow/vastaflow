import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { DocumentFile, DocumentPage, RoleName, User } from '../../api/client';
import { AuthProvider } from '../../auth/AuthContext';
import { formatFileSize, formatMimeType } from './document-format';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Handler = Reply | ((init: RequestInit | undefined) => Reply | Promise<Reply>);

/** Requisicoes capturadas, para conferir metodo, corpo e cabecalhos. */
let chamadas: { url: string; init: RequestInit | undefined }[] = [];

function mockApi(routes: Record<string, Handler>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) {
      throw new TypeError(`fetch nao mockado: ${key}`);
    }
    const reply = typeof handler === 'function' ? await handler(init) : handler;
    const headers = { 'Content-Type': 'application/json', ...reply.headers };
    return reply.body === undefined
      ? new Response(null, { status: reply.status })
      : new Response(reply.body instanceof Blob ? reply.body : JSON.stringify(reply.body), {
          status: reply.status,
          headers,
        });
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

const COM_TUDO = makeUser('gestor', 'GESTOR', ['documents:read', 'documents:create']);
const SO_LEITURA = makeUser('leitor', 'OPERADOR', ['documents:read']);
const SEM_ACESSO = makeUser('comum', 'USUARIO', []);

const documento = (overrides: Partial<DocumentFile> = {}): DocumentFile => ({
  id: 'doc-1',
  nome: 'Contrato João.pdf',
  nomeOriginal: 'Contrato João.pdf',
  mimeType: 'application/pdf',
  tamanho: 182_344,
  criadoPorId: 'gestor',
  criadoPor: { id: 'gestor', nome: 'Gabi Gestora', email: 'gestor@vasta.test' },
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
  ...overrides,
});

const pagina = (items: DocumentFile[], overrides: Partial<DocumentPage> = {}): DocumentPage => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  ...overrides,
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

const chamadasPara = (caminho: string, metodo = 'GET'): typeof chamadas =>
  chamadas.filter(
    ({ url, init }) =>
      new URL(url).pathname === caminho && (init?.method ?? 'GET') === metodo,
  );

/** Captura os downloads disparados, que o jsdom nao implementa. */
const definidosEmURL: string[] = [];

function espionarDownload(): { cliques: { download: string }[] } {
  const cliques: { download: string }[] = [];
  let contador = 0;

  for (const [nome, implementacao] of [
    ['createObjectURL', () => `blob:fake/${++contador}`],
    ['revokeObjectURL', () => undefined],
  ] as const) {
    Object.defineProperty(URL, nome, {
      value: vi.fn(implementacao),
      configurable: true,
      writable: true,
    });
    definidosEmURL.push(nome);
  }

  const clickOriginal = Reflect.get(HTMLAnchorElement.prototype, 'click');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (this.download) {
      cliques.push({ download: this.download });
      return;
    }
    clickOriginal.call(this);
  });

  return { cliques };
}

/** Escolhe um arquivo no seletor oculto. */
async function escolherArquivo(file: File): Promise<void> {
  const input = document.getElementById('documento-arquivo') as HTMLInputElement;
  await userEvent.setup().upload(input, file);
}

beforeEach(() => {
  chamadas = [];
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

describe('acesso a tela de documentos', () => {
  it('quem tem documents:read abre a tela', async () => {
    mockApi(session(SO_LEITURA, { 'GET /documents': { status: 200, body: pagina([documento()]) } }));

    renderAt('/documents');

    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
  });

  it('quem nao tem documents:read nao abre a tela nem chama a API', async () => {
    mockApi(session(SEM_ACESSO));

    renderAt('/documents');

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Documentos' })).toBeNull();
    });
    expect(chamadasPara('/documents')).toHaveLength(0);
  });

  it('sem documents:create o botao de enviar nao aparece', async () => {
    mockApi(session(SO_LEITURA, { 'GET /documents': { status: 200, body: pagina([documento()]) } }));

    renderAt('/documents');
    await screen.findByRole('heading', { name: 'Documentos' });

    expect(screen.queryByText('Enviar documento')).toBeNull();
    expect(document.getElementById('documento-arquivo')).toBeNull();
  });

  it('com documents:create o botao aparece', async () => {
    mockApi(session(COM_TUDO, { 'GET /documents': { status: 200, body: pagina([documento()]) } }));

    renderAt('/documents');
    await screen.findByRole('heading', { name: 'Documentos' });

    expect(screen.getByText('Enviar documento')).toBeInTheDocument();
  });

  it('o menu mostra Documentos so para quem pode ler', async () => {
    mockApi(session(SO_LEITURA, { 'GET /documents': { status: 200, body: pagina([]) } }));
    renderAt('/documents');
    await screen.findByRole('heading', { name: 'Documentos' });

    expect(screen.getByRole('link', { name: 'Documentos' })).toHaveAttribute('href', '/documents');
  });
});

describe('listagem', () => {
  async function abrir(items: DocumentFile[], overrides: Partial<DocumentPage> = {}): Promise<void> {
    mockApi(
      session(COM_TUDO, { 'GET /documents': { status: 200, body: pagina(items, overrides) } }),
    );
    renderAt('/documents');
    await screen.findByRole('heading', { name: 'Documentos' });
  }

  it('mostra nome, tipo, tamanho, autor e data', async () => {
    await abrir([documento()]);

    const linha = (await screen.findByRole('cell', { name: 'Contrato João.pdf' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(linha).getByRole('cell', { name: 'PDF' })).toBeInTheDocument();
    expect(within(linha).getByRole('cell', { name: '178,1 KB' })).toBeInTheDocument();
    expect(within(linha).getByRole('cell', { name: 'Gabi Gestora' })).toBeInTheDocument();
  });

  it('autor removido do sistema nao quebra a linha', async () => {
    await abrir([documento({ criadoPor: null })]);

    const linha = (await screen.findByRole('cell', { name: 'Contrato João.pdf' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(linha).getByRole('cell', { name: '—' })).toBeInTheDocument();
  });

  it('nao mostra chave de storage nem caminho fisico', async () => {
    await abrir([documento()]);

    expect(document.body.textContent).not.toMatch(/\.bin|storageKey|storage_key/);
  });

  it('sem documentos, diz isso em vez de tabela vazia', async () => {
    await abrir([]);

    expect(await screen.findByText('Nenhum documento enviado ainda.')).toBeInTheDocument();
  });

  it('pede a primeira pagina com o limite padrao', async () => {
    await abrir([documento()]);

    // Espera a chamada ser REGISTRADA: aguardar so o titulo nao garante que o
    // efeito de busca ja rodou, e o teste ficaria intermitente.
    await waitFor(() => {
      expect(chamadasPara('/documents').length).toBeGreaterThan(0);
    });
    const params = new URL(chamadasPara('/documents')[0].url).searchParams;
    expect(params.get('page')).toBe('1');
    expect(params.get('limit')).toBe('20');
  });

  it('erro ao carregar mostra aviso e permite tentar de novo', async () => {
    mockApi(session(COM_TUDO, { 'GET /documents': { status: 500, body: { message: 'falhou' } } }));
    renderAt('/documents');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Não foi possível carregar os documentos/i,
    );
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});

describe('upload', () => {
  const ARQUIVO = (): File =>
    new File(['%PDF-conteudo'], 'contrato.pdf', { type: 'application/pdf' });

  async function abrirParaEnviar(uploadReply: Handler): Promise<void> {
    mockApi(
      session(COM_TUDO, {
        'GET /documents': { status: 200, body: pagina([]) },
        'POST /documents': uploadReply,
      }),
    );
    renderAt('/documents');
    await screen.findByRole('heading', { name: 'Documentos' });
  }

  it('envia como multipart, com FormData', async () => {
    await abrirParaEnviar({ status: 201, body: documento({ nome: 'contrato.pdf' }) });

    await escolherArquivo(ARQUIVO());

    await waitFor(() => {
      expect(chamadasPara('/documents', 'POST')).toHaveLength(1);
    });
    const { init } = chamadasPara('/documents', 'POST')[0];
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('arquivo')).toBeInstanceOf(File);
  });

  it('NAO define Content-Type: o boundary e do navegador', async () => {
    // Definir a mao quebraria o parser do servidor, porque o boundary nao
    // bateria com o do corpo.
    await abrirParaEnviar({ status: 201, body: documento() });

    await escolherArquivo(ARQUIVO());

    await waitFor(() => {
      expect(chamadasPara('/documents', 'POST')).toHaveLength(1);
    });
    const headers = chamadasPara('/documents', 'POST')[0].init?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });

  it('continua enviando o token JWT', async () => {
    await abrirParaEnviar({ status: 201, body: documento() });

    await escolherArquivo(ARQUIVO());

    await waitFor(() => {
      expect(chamadasPara('/documents', 'POST')).toHaveLength(1);
    });
    const headers = chamadasPara('/documents', 'POST')[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-guardado');
  });

  it('sucesso avisa e recarrega a listagem', async () => {
    await abrirParaEnviar({ status: 201, body: documento({ nome: 'contrato.pdf' }) });
    const antes = chamadasPara('/documents').length;

    await escolherArquivo(ARQUIVO());

    expect(await screen.findByRole('status')).toHaveTextContent('"contrato.pdf" enviado.');
    await waitFor(() => {
      expect(chamadasPara('/documents').length).toBeGreaterThan(antes);
    });
  });

  it('recusa do backend aparece com a mensagem dele', async () => {
    // Extensao ACEITA pelo seletor, recusada pelo servidor - por exemplo um
    // `.pdf` cujo conteudo declarado nao corresponde. E o caminho realista:
    // o `accept` do seletor ja barra `.exe` antes de sair do navegador.
    await abrirParaEnviar({
      status: 400,
      body: { message: 'O tipo informado nao corresponde a extensao .pdf' },
    });

    await escolherArquivo(ARQUIVO());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /O tipo informado nao corresponde/,
    );
  });

  it('o seletor ja filtra extensao proibida no navegador', async () => {
    // Primeira barreira, antes de qualquer requisicao. A segunda e a validacao
    // do servidor, que nao depende desta.
    await abrirParaEnviar({ status: 201, body: documento() });
    const input = document.getElementById('documento-arquivo') as HTMLInputElement;

    expect(input.accept).toBe('.pdf,.xlsx,.xls,.csv,.docx,.xml');
    expect(input.accept).not.toMatch(/exe|html|svg|js/);

    // `userEvent.upload` respeita o `accept`: o arquivo nem e selecionado.
    await userEvent.setup().upload(input, new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }));

    expect(input.files?.length ?? 0).toBe(0);
    expect(chamadasPara('/documents', 'POST')).toHaveLength(0);
  });

  it('arquivo grande demais (413) mostra mensagem clara', async () => {
    // Sem o tratamento de 413, cairia em "algo deu errado", que nao diz o que
    // fazer.
    await abrirParaEnviar({ status: 413, body: { message: 'Payload Too Large' } });

    await escolherArquivo(ARQUIVO());

    expect(await screen.findByRole('alert')).toHaveTextContent(/Arquivo grande demais/);
  });

  it('sem permissao (403) mostra mensagem de permissao', async () => {
    await abrirParaEnviar({ status: 403, body: { message: 'Proibido' } });

    await escolherArquivo(ARQUIVO());

    expect(await screen.findByRole('alert')).toHaveTextContent(/não tem permissão/i);
  });

  it('o erro de upload nao expoe stack nem caminho', async () => {
    await abrirParaEnviar({
      status: 500,
      body: { message: 'Erro interno do servidor', incidentId: 'abc' },
    });

    await escolherArquivo(ARQUIVO());

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').not.toMatch(/at |\.ts:|\.js:|\/var\/|[A-Za-z]:\\/);
  });
});

describe('download', () => {
  async function abrirParaBaixar(downloadReply: Handler): Promise<{ cliques: { download: string }[] }> {
    const espiao = espionarDownload();
    mockApi(
      session(COM_TUDO, {
        'GET /documents': { status: 200, body: pagina([documento()]) },
        'GET /documents/doc-1/download': downloadReply,
      }),
    );
    renderAt('/documents');
    await screen.findByRole('heading', { name: 'Documentos' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Baixar' }));
    return espiao;
  }

  it('baixa usando Blob, com o nome que o backend definiu', async () => {
    const { cliques } = await abrirParaBaixar({
      status: 200,
      body: new Blob(['%PDF'], { type: 'application/pdf' }),
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Contrato Joao.pdf"',
      },
    });

    await waitFor(() => {
      expect(cliques).toHaveLength(1);
    });
    expect(cliques[0].download).toBe('Contrato Joao.pdf');
  });

  it('sem Content-Disposition, usa o nome original do documento', async () => {
    const { cliques } = await abrirParaBaixar({
      status: 200,
      body: new Blob(['%PDF'], { type: 'application/pdf' }),
    });

    await waitFor(() => {
      expect(cliques).toHaveLength(1);
    });
    expect(cliques[0].download).toBe('Contrato João.pdf');
  });

  it('o download usa o id, nunca a chave de storage', async () => {
    await abrirParaBaixar({ status: 200, body: new Blob(['%PDF']) });

    await waitFor(() => {
      expect(chamadasPara('/documents/doc-1/download')).toHaveLength(1);
    });
  });

  it('documento inexistente (404) mostra aviso, sem baixar', async () => {
    const { cliques } = await abrirParaBaixar({
      status: 404,
      body: { message: 'Documento nao encontrado' },
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(cliques).toHaveLength(0);
  });

  it('storage indisponivel (500) nao expoe detalhe', async () => {
    const { cliques } = await abrirParaBaixar({
      status: 500,
      body: { message: 'Erro interno do servidor', incidentId: 'abc' },
    });

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').not.toMatch(/\.bin|storage|\/var\/|EACCES/i);
    expect(cliques).toHaveLength(0);
  });
});

describe('formatacao', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1,0 KB'],
    [182_344, '178,1 KB'],
    [10 * 1024 * 1024, '10,0 MB'],
    [3 * 1024 * 1024 * 1024, '3,0 GB'],
  ])('%i bytes -> %s', (bytes, esperado) => {
    expect(formatFileSize(bytes)).toBe(esperado);
  });

  it('tamanho invalido nao gera texto estranho', () => {
    expect(formatFileSize(Number.NaN)).toBe('-');
    expect(formatFileSize(-1)).toBe('-');
  });

  it.each([
    ['application/pdf', 'PDF'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
    ['text/csv', 'CSV'],
    ['application/xml', 'XML'],
    ['application/pdf; charset=utf-8', 'PDF'],
    ['APPLICATION/PDF', 'PDF'],
  ])('%s -> %s', (mime, esperado) => {
    expect(formatMimeType(mime)).toBe(esperado);
  });

  it('MIME desconhecido nao vaza string tecnica para a tela', () => {
    expect(formatMimeType('application/x-coisa-estranha')).toBe('Arquivo');
  });
});
