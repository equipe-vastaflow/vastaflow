import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { RoleName, SystemSetting, User } from '../../api/client';
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

const ADMIN = makeUser('admin', 'ADMIN');
/** Le mas nao altera: exercita a tela sem `settings:update`. */
const SO_LEITURA = makeUser('leitor', 'OPERADOR', ['settings:read']);
/** GESTOR tem outras permissoes administrativas, mas nao as de configuracao. */
const GESTOR = makeUser('gestor', 'GESTOR', ['users:read', 'audit:read', 'finance:read']);

function setting(overrides: Partial<SystemSetting> = {}): SystemSetting {
  return {
    chave: 'SYSTEM_NAME',
    valor: 'VastaFlow',
    descricao: 'Nome do sistema exibido nas telas',
    tipo: 'STRING',
    atualizadoPorId: null,
    atualizadoPor: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

const TEXTO = setting();
const NUMERO = setting({
  chave: 'PAGINATION_DEFAULT_LIMIT',
  valor: 20,
  tipo: 'NUMBER',
  descricao: 'Itens por pagina nas listagens',
});
const BOOLEANO = setting({
  chave: 'FEATURE_ENABLED',
  valor: false,
  tipo: 'BOOLEAN',
  descricao: 'Liga um recurso opcional',
});

const LISTA = [BOOLEANO, NUMERO, TEXTO];

function renderAt(
  path: string,
  me: User,
  extra: Record<string, Handler> = {},
): ReturnType<typeof vi.fn> {
  localStorage.setItem(
    'vastaflow.session',
    JSON.stringify({
      token: 'jwt-guardado',
      expiresAt: Date.now() + 60 * 60 * 1000,
    }),
  );
  const fetchMock = mockApi({
    'GET /auth/me': { status: 200, body: me },
    // O contador do menu consulta isto em toda pagina autenticada.
    'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
    'GET /dashboard/summary': { status: 200, body: {} },
    'GET /settings': { status: 200, body: LISTA },
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

/** Linha da tabela cuja primeira celula e a chave informada. */
async function linhaDe(chave: string): Promise<HTMLElement> {
  const celula = await screen.findByText(chave);
  const linha = celula.closest('tr');
  if (!linha) {
    throw new Error(`linha de ${chave} nao encontrada`);
  }
  return linha;
}

/** Corpo JSON enviado na ultima chamada PATCH. */
function ultimoPatch(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const calls = fetchMock.mock.calls as [string, RequestInit][];
  const patch = [...calls].reverse().find(([, init]) => init.method === 'PATCH');
  const body = patch?.[1].body;
  if (typeof body !== 'string') {
    throw new Error('nenhuma chamada PATCH com corpo JSON');
  }
  return JSON.parse(body);
}

describe('Tela de configuracoes', () => {
  describe('acesso', () => {
    it('quem tem settings:read acessa a tela', async () => {
      renderAt('/settings', SO_LEITURA);

      expect(await heading('Configurações')).toBeInTheDocument();
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('ADMIN acessa a tela', async () => {
      renderAt('/settings', ADMIN);

      expect(await heading('Configurações')).toBeInTheDocument();
    });

    it('quem nao tem settings:read ve acesso negado, e a tela nem e consultada', async () => {
      const fetchMock = renderAt('/settings', GESTOR);

      expect(await heading('Acesso negado')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      await waitFor(() => {
        const urls = (fetchMock.mock.calls as [string][]).map(([url]) => url);
        expect(urls.some((url) => url.includes('/settings'))).toBe(false);
      });
    });

    it('o menu so mostra Configuracoes para quem tem a permissao', async () => {
      renderAt('/settings', SO_LEITURA);
      await heading('Configurações');

      expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument();
    });

    it('o menu esconde Configuracoes de quem nao tem a permissao', async () => {
      renderAt('/dashboard', GESTOR);
      await heading('Dashboard');

      expect(screen.queryByRole('link', { name: 'Configurações' })).not.toBeInTheDocument();
    });
  });

  describe('estados da lista', () => {
    it('mostra o estado de carregamento antes da resposta', async () => {
      renderAt('/settings', ADMIN, {
        'GET /settings': () =>
          new Promise<Reply>((resolve) => {
            setTimeout(() => {
              resolve({ status: 200, body: LISTA });
            }, 30);
          }),
      });

      expect(await screen.findByText('Carregando configurações…')).toBeInTheDocument();
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('lista preenchida mostra chave, descricao, tipo e valor', async () => {
      renderAt('/settings', ADMIN);
      const linha = await linhaDe('SYSTEM_NAME');

      expect(within(linha).getByText('Nome do sistema exibido nas telas')).toBeInTheDocument();
      expect(within(linha).getByText('Texto')).toBeInTheDocument();
      expect(within(linha).getByText('VastaFlow')).toBeInTheDocument();
    });

    it('mostra a ultima atualizacao e quem alterou', async () => {
      renderAt('/settings', ADMIN, {
        'GET /settings': {
          status: 200,
          body: [
            setting({
              atualizadoPorId: 'admin',
              atualizadoPor: {
                id: 'admin',
                nome: 'Ana Admin',
                email: 'ana@vasta.test',
              },
              updatedAt: '2026-09-22T15:30:00.000Z',
            }),
          ],
        },
      });
      const linha = await linhaDe('SYSTEM_NAME');

      expect(within(linha).getByText('Ana Admin')).toBeInTheDocument();
      expect(within(linha).getByText(/22\/09\/2026/)).toBeInTheDocument();
    });

    it('booleano aparece como Sim/Nao, nunca como true/false', async () => {
      renderAt('/settings', ADMIN);
      const linha = await linhaDe('FEATURE_ENABLED');

      expect(within(linha).getByText('Não')).toBeInTheDocument();
      expect(within(linha).queryByText('false')).not.toBeInTheDocument();
    });

    it('lista vazia diz que nao ha configuracoes', async () => {
      renderAt('/settings', ADMIN, {
        'GET /settings': { status: 200, body: [] },
      });

      expect(await screen.findByText('Nenhuma configuração cadastrada.')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('erro na consulta mostra alerta e permite tentar de novo', async () => {
      let chamadas = 0;
      renderAt('/settings', ADMIN, {
        'GET /settings': () => {
          chamadas += 1;
          return chamadas === 1 ? { status: 500, body: {} } : { status: 200, body: LISTA };
        },
      });

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar as configurações.');

      await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByRole('table')).toBeInTheDocument();
    });
  });

  describe('permissao de edicao', () => {
    it('sem settings:update nao ha botao de editar', async () => {
      renderAt('/settings', SO_LEITURA);
      await screen.findByRole('table');

      expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument();
    });

    it('ADMIN ve um botao de editar por configuracao', async () => {
      renderAt('/settings', ADMIN);
      await screen.findByRole('table');

      expect(await screen.findAllByRole('button', { name: 'Editar' })).toHaveLength(LISTA.length);
    });
  });

  describe('edicao por tipo', () => {
    it('STRING edita em campo de texto e envia texto', async () => {
      const fetchMock = renderAt('/settings', ADMIN, {
        'PATCH /settings/SYSTEM_NAME': {
          status: 200,
          body: setting({ valor: 'Vasta' }),
        },
      });
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      const campo = within(linha).getByRole('textbox', {
        name: 'Valor de SYSTEM_NAME',
      });
      await userEvent.clear(campo);
      await userEvent.type(campo, 'Vasta');
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      await waitFor(() => {
        expect(ultimoPatch(fetchMock)).toEqual({ valor: 'Vasta' });
      });
    });

    it('NUMBER edita em campo numerico e envia numero, nao string', async () => {
      const fetchMock = renderAt('/settings', ADMIN, {
        'PATCH /settings/PAGINATION_DEFAULT_LIMIT': {
          status: 200,
          body: setting({
            chave: 'PAGINATION_DEFAULT_LIMIT',
            valor: 50,
            tipo: 'NUMBER',
          }),
        },
      });
      const linha = await linhaDe('PAGINATION_DEFAULT_LIMIT');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      const campo = within(linha).getByRole('spinbutton', {
        name: 'Valor de PAGINATION_DEFAULT_LIMIT',
      });
      await userEvent.clear(campo);
      await userEvent.type(campo, '50');
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      await waitFor(() => {
        expect(ultimoPatch(fetchMock)).toEqual({ valor: 50 });
      });
    });

    it('BOOLEAN edita em caixa de marcacao e envia booleano, nao a string "true"', async () => {
      const fetchMock = renderAt('/settings', ADMIN, {
        'PATCH /settings/FEATURE_ENABLED': {
          status: 200,
          body: setting({
            chave: 'FEATURE_ENABLED',
            valor: true,
            tipo: 'BOOLEAN',
          }),
        },
      });
      const linha = await linhaDe('FEATURE_ENABLED');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.click(
        within(linha).getByRole('checkbox', {
          name: 'Valor de FEATURE_ENABLED',
        }),
      );
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      await waitFor(() => {
        expect(ultimoPatch(fetchMock)).toEqual({ valor: true });
      });
    });

    it('nao ha campo para chave, tipo nem descricao', async () => {
      renderAt('/settings', ADMIN);
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));

      expect(within(linha).getAllByRole('textbox')).toHaveLength(1);
      expect(within(linha).queryByRole('textbox', { name: /chave/i })).not.toBeInTheDocument();
      expect(within(linha).queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('cancelar volta ao valor exibido, sem enviar nada', async () => {
      const fetchMock = renderAt('/settings', ADMIN);
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.type(
        within(linha).getByRole('textbox', { name: 'Valor de SYSTEM_NAME' }),
        'X',
      );
      await userEvent.click(within(linha).getByRole('button', { name: 'Cancelar' }));

      expect(within(linha).getByText('VastaFlow')).toBeInTheDocument();
      expect(
        (fetchMock.mock.calls as [string, RequestInit][]).some(([, i]) => i.method === 'PATCH'),
      ).toBe(false);
    });
  });

  describe('envio', () => {
    it('sucesso mostra confirmacao e recarrega a lista', async () => {
      const fetchMock = renderAt('/settings', ADMIN, {
        'PATCH /settings/SYSTEM_NAME': {
          status: 200,
          body: setting({ valor: 'Vasta' }),
        },
      });
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Configuração SYSTEM_NAME atualizada.',
      );
      await waitFor(() => {
        const listagens = (fetchMock.mock.calls as [string, RequestInit][]).filter(
          ([url, init]) => url.endsWith('/settings') && (init.method ?? 'GET') === 'GET',
        );
        expect(listagens.length).toBe(2);
      });
    });

    it('duplo clique em Salvar dispara apenas uma requisicao', async () => {
      let emAndamento: (reply: Reply) => void = () => undefined;
      const fetchMock = renderAt('/settings', ADMIN, {
        'PATCH /settings/SYSTEM_NAME': () =>
          new Promise<Reply>((resolve) => {
            emAndamento = resolve;
          }),
      });
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      const salvar = within(linha).getByRole('button', { name: 'Salvar' });
      await userEvent.click(salvar);
      // O botao fica desabilitado enquanto salva; o segundo clique nao tem efeito.
      expect(within(linha).getByRole('button', { name: 'Salvando…' })).toBeDisabled();
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvando…' }));

      emAndamento({ status: 200, body: setting() });

      await waitFor(() => {
        const patches = (fetchMock.mock.calls as [string, RequestInit][]).filter(
          ([, init]) => init.method === 'PATCH',
        );
        expect(patches).toHaveLength(1);
      });
    });

    it('valor invalido nem chega a ser enviado', async () => {
      const fetchMock = renderAt('/settings', ADMIN);
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.clear(within(linha).getByRole('textbox', { name: 'Valor de SYSTEM_NAME' }));
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Informe um valor válido para esta configuração.',
      );
      expect(
        (fetchMock.mock.calls as [string, RequestInit][]).some(([, i]) => i.method === 'PATCH'),
      ).toBe(false);
    });

    it('400 do backend aparece como erro de validacao', async () => {
      renderAt('/settings', ADMIN, {
        'PATCH /settings/SYSTEM_NAME': {
          status: 400,
          body: { message: 'SYSTEM_NAME (STRING): valor nao pode ser vazio' },
        },
      });
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Dados inválidos');
    });

    it('403 informa falta de permissao', async () => {
      renderAt('/settings', ADMIN, {
        'PATCH /settings/SYSTEM_NAME': {
          status: 403,
          body: { message: 'sem permissao' },
        },
      });
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Você não tem permissão para esta ação.',
      );
    });

    it('404 fala de configuracao, nao de usuario', async () => {
      renderAt('/settings', ADMIN, {
        'PATCH /settings/SYSTEM_NAME': {
          status: 404,
          body: { message: 'nao encontrada' },
        },
      });
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Configuração não encontrada.');
      expect(alerta).not.toHaveTextContent('Usuário');
    });

    it('401 encerra a sessao e leva ao login', async () => {
      renderAt('/settings', ADMIN, {
        'PATCH /settings/SYSTEM_NAME': {
          status: 401,
          body: { message: 'expirado' },
        },
        'POST /auth/logout': { status: 204 },
      });
      const linha = await linhaDe('SYSTEM_NAME');

      await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
      await userEvent.click(within(linha).getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByText('Entre com sua conta para continuar.')).toBeInTheDocument();
    });
  });
});
