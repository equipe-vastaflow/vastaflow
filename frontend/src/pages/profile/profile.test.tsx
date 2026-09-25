import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type { Profile, RoleName, User } from '../../api/client';
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

/** Perfil sem nenhuma permissao: o perfil proprio nao e privilegio administrativo. */
const COMUM = makeUser('comum', 'USUARIO');

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'comum',
    nome: 'Maria Silva',
    email: 'maria@vasta.test',
    role: 'USUARIO',
    ativo: true,
    createdAt: '2026-03-10T12:00:00.000Z',
    updatedAt: '2026-03-10T12:00:00.000Z',
    ...overrides,
  };
}

const PERFIL = profile();

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
    'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
    'GET /profile': { status: 200, body: PERFIL },
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

const campoNome = (): HTMLElement => screen.getByRole('textbox', { name: 'Nome' });

function chamadas(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit][] {
  return fetchMock.mock.calls as [string, RequestInit][];
}

/** Corpo JSON da ultima chamada PATCH a /profile. */
function ultimoPatch(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const patch = [...chamadas(fetchMock)]
    .reverse()
    .find(([url, init]) => init.method === 'PATCH' && url.endsWith('/profile'));
  const body = patch?.[1].body;
  if (typeof body !== 'string') {
    throw new Error('nenhuma chamada PATCH /profile com corpo JSON');
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function patches(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit][] {
  return chamadas(fetchMock).filter(
    ([url, init]) => init.method === 'PATCH' && url.endsWith('/profile'),
  );
}

describe('Tela de perfil', () => {
  describe('acesso', () => {
    it('qualquer usuario autenticado acessa o proprio perfil', async () => {
      renderAt('/profile', COMUM);

      expect(await heading('Meu perfil')).toBeInTheDocument();
    });

    it('o menu leva para a tela', async () => {
      renderAt('/dashboard', COMUM);
      await heading('Dashboard');

      expect(screen.getByRole('link', { name: 'Meu perfil' })).toHaveAttribute('href', '/profile');
    });

    it('nao envia nenhum identificador de usuario ao carregar', async () => {
      const fetchMock = renderAt('/profile', COMUM);
      await heading('Meu perfil');

      const [url] = chamadas(fetchMock).find(([u]) => u.includes('/profile')) ?? [''];
      expect(new URL(url).pathname).toBe('/profile');
      expect(new URL(url).search).toBe('');
    });
  });

  describe('carregamento', () => {
    it('mostra o estado de carregamento antes da resposta', async () => {
      renderAt('/profile', COMUM, {
        'GET /profile': () =>
          new Promise<Reply>((resolve) => {
            setTimeout(() => {
              resolve({ status: 200, body: PERFIL });
            }, 30);
          }),
      });

      expect(await screen.findByText('Carregando perfil…')).toBeInTheDocument();
      expect(await screen.findByRole('textbox', { name: 'Nome' })).toBeInTheDocument();
    });

    it('preenche o formulario com os dados carregados', async () => {
      renderAt('/profile', COMUM);

      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });
    });

    it('erro na consulta mostra alerta e permite tentar de novo', async () => {
      let tentativas = 0;
      renderAt('/profile', COMUM, {
        'GET /profile': () => {
          tentativas += 1;
          return tentativas === 1 ? { status: 500, body: {} } : { status: 200, body: PERFIL };
        },
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível carregar seu perfil.',
      );

      await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });
    });
  });

  describe('campos', () => {
    it('o nome e editavel', async () => {
      renderAt('/profile', COMUM);
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      expect(campoNome()).toBeEnabled();
    });

    it('e-mail, perfil e situacao aparecem como leitura, sem campo de edicao', async () => {
      renderAt('/profile', COMUM);
      await heading('Meu perfil');

      expect(await screen.findByText('maria@vasta.test')).toBeInTheDocument();
      expect(screen.getByText('Usuário')).toBeInTheDocument();
      expect(screen.getByText('Ativo')).toBeInTheDocument();

      // Um unico campo de formulario na tela: o nome.
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('nao ha campo de senha', async () => {
      renderAt('/profile', COMUM);
      await heading('Meu perfil');

      expect(document.querySelector('input[type="password"]')).toBeNull();
    });

    it('a tela diz o que nao e editavel aqui', async () => {
      renderAt('/profile', COMUM);

      expect(
        await screen.findByText(/Troca de senha e de e-mail ainda não estão disponíveis/),
      ).toBeInTheDocument();
    });

    it('perfil inativo aparece como Inativo', async () => {
      renderAt('/profile', COMUM, {
        'GET /profile': { status: 200, body: profile({ ativo: false }) },
      });

      expect(await screen.findByText('Inativo')).toBeInTheDocument();
    });
  });

  describe('salvar', () => {
    it('envia SOMENTE o nome, nunca id, perfil, situacao, e-mail ou senha', async () => {
      const fetchMock = renderAt('/profile', COMUM, {
        'PATCH /profile': { status: 200, body: profile({ nome: 'Maria Souza' }) },
        'GET /auth/me': { status: 200, body: COMUM },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Maria Souza');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => {
        expect(ultimoPatch(fetchMock)).toEqual({ nome: 'Maria Souza' });
      });
      const corpo = ultimoPatch(fetchMock);
      for (const proibido of ['id', 'role', 'permissions', 'ativo', 'senha', 'email', 'userId']) {
        expect(corpo).not.toHaveProperty(proibido);
      }
    });

    it('sucesso mostra confirmacao e mantem a tela, sem recarregar', async () => {
      // Servidor com estado, como o de verdade: depois do PATCH, o GET passa a
      // devolver o nome novo. Com um mock estatico o teste mentiria sobre o que
      // a pessoa ve depois de salvar.
      let salvo = PERFIL;
      renderAt('/profile', COMUM, {
        'GET /profile': () => ({ status: 200, body: salvo }),
        'PATCH /profile': () => {
          salvo = profile({ nome: 'Maria Souza' });
          return { status: 200, body: salvo };
        },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Maria Souza');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Perfil atualizado com sucesso.');
      // A mesma tela continua montada, agora com o valor novo.
      expect(await heading('Meu perfil')).toBeInTheDocument();
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Souza');
      });
    });

    /**
     * Ao salvar, a tela ja recebe o perfil atualizado na resposta do PATCH - e
     * ainda assim ha UMA releitura, porque `refreshUser()` renova a sessao e o
     * efeito de carga depende dela. Uma so: se virar duas, a tela passou a
     * recarregar em cascata; se virar zero, ela deixou de confirmar o estado
     * com o servidor. O numero fica fixado aqui de proposito.
     */
    it('salvar dispara exatamente uma releitura do perfil', async () => {
      let salvo = PERFIL;
      const fetchMock = renderAt('/profile', COMUM, {
        'GET /profile': () => ({ status: 200, body: salvo }),
        'PATCH /profile': () => {
          salvo = profile({ nome: 'Maria Souza' });
          return { status: 200, body: salvo };
        },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });
      const leiturasIniciais = chamadas(fetchMock).filter(
        ([url, init]) => url.endsWith('/profile') && (init.method ?? 'GET') === 'GET',
      ).length;

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Maria Souza');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      await screen.findByRole('status');

      const leiturasDepois = chamadas(fetchMock).filter(
        ([url, init]) => url.endsWith('/profile') && (init.method ?? 'GET') === 'GET',
      ).length;
      // No maximo uma releitura, e ela e consistente com o que foi gravado.
      expect(leiturasDepois - leiturasIniciais).toBe(1);
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Souza');
      });
    });

    it('rele a sessao para o nome acompanhar no resto da aplicacao', async () => {
      const fetchMock = renderAt('/profile', COMUM, {
        'PATCH /profile': { status: 200, body: profile({ nome: 'Maria Souza' }) },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });
      const antes = chamadas(fetchMock).filter(([url]) => url.includes('/auth/me')).length;

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Maria Souza');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      await waitFor(() => {
        expect(chamadas(fetchMock).filter(([url]) => url.includes('/auth/me')).length).toBe(
          antes + 1,
        );
      });
    });

    it('sem alteracao nao chama a API', async () => {
      const fetchMock = renderAt('/profile', COMUM);
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Nenhuma alteração para salvar.');
      expect(patches(fetchMock)).toHaveLength(0);
    });

    it('nome vazio bloqueia o envio e avisa', async () => {
      const fetchMock = renderAt('/profile', COMUM);
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());

      expect(await screen.findByRole('alert')).toHaveTextContent('O nome não pode ficar vazio.');
      expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
      expect(patches(fetchMock)).toHaveLength(0);
    });

    it('duplo clique dispara apenas uma requisicao', async () => {
      let concluir: (reply: Reply) => void = () => undefined;
      const fetchMock = renderAt('/profile', COMUM, {
        'PATCH /profile': () =>
          new Promise<Reply>((resolve) => {
            concluir = resolve;
          }),
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Maria Souza');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Salvando…' }));

      concluir({ status: 200, body: profile({ nome: 'Maria Souza' }) });

      await waitFor(() => {
        expect(patches(fetchMock)).toHaveLength(1);
      });
    });
  });

  describe('erros da API', () => {
    it('400 aparece como erro de validacao', async () => {
      renderAt('/profile', COMUM, {
        'PATCH /profile': {
          status: 400,
          body: { message: 'O nome nao pode ficar vazio' },
        },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Outro Nome');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      const alertas = await screen.findAllByRole('alert');
      expect(alertas.some((a) => a.textContent?.includes('Dados inválidos'))).toBe(true);
      // A tela continua utilizavel depois do erro.
      expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    });

    it('401 encerra a sessao e leva ao login', async () => {
      renderAt('/profile', COMUM, {
        'PATCH /profile': { status: 401, body: { message: 'expirado' } },
        'POST /auth/logout': { status: 204 },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Outro Nome');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      expect(await screen.findByText('Entre com sua conta para continuar.')).toBeInTheDocument();
    });

    it('404 fala da conta, nao de usuario generico', async () => {
      renderAt('/profile', COMUM, {
        'PATCH /profile': { status: 404, body: { message: 'nao encontrado' } },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Outro Nome');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      const alertas = await screen.findAllByRole('alert');
      expect(alertas.some((a) => a.textContent?.includes('Sua conta não foi encontrada'))).toBe(
        true,
      );
    });

    it('erro de rede nao derruba a tela', async () => {
      renderAt('/profile', COMUM, {
        'PATCH /profile': () => {
          throw new TypeError('rede fora');
        },
      });
      await waitFor(() => {
        expect(campoNome()).toHaveValue('Maria Silva');
      });

      await userEvent.clear(campoNome());
      await userEvent.type(campoNome(), 'Outro Nome');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

      const alertas = await screen.findAllByRole('alert');
      expect(alertas.some((a) => a.textContent?.includes('conectar ao servidor'))).toBe(true);
      expect(within(await heading('Meu perfil')).queryByText('erro')).toBeNull();
    });
  });
});
