import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type {
  CreatedIdentityLinkRequest,
  ExternalIdentity,
  IdentityLinkRequest,
  RoleName,
  User,
} from '../../api/client';
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
/** Le usuarios mas nao os edita: nao deve receber nenhuma acao de vinculo. */
const SO_LEITURA = makeUser('leitor', 'GESTOR', ['users:read']);

const ALVO = makeUser('alvo', 'USUARIO');

const LINK: ExternalIdentity = {
  id: 'link-1',
  canal: 'telegram',
  idExterno: '123456789',
  createdAt: '2026-09-20T10:00:00.000Z',
};

const PENDENTE: IdentityLinkRequest = {
  id: 'req-1',
  canal: 'telegram',
  status: 'PENDENTE',
  expiraEm: '2099-01-01T10:15:00.000Z',
  createdAt: '2099-01-01T10:00:00.000Z',
};

const CRIADA: CreatedIdentityLinkRequest = {
  ...PENDENTE,
  codigo: 'K7QM-2XRA-9CVB',
  instrucao: 'Envie ao bot do Telegram, em conversa privada: /vincular K7QM-2XRA-9CVB',
};

const ROTAS = {
  links: 'GET /users/alvo/external-identities',
  requests: 'GET /users/alvo/external-identities/link-requests',
  criar: 'POST /users/alvo/external-identities/link-requests',
  cancelar: 'DELETE /users/alvo/external-identities/link-requests/req-1',
  remover: 'DELETE /users/alvo/external-identities/link-1',
} as const;

function renderDetalhe(me: User, extra: Record<string, Handler> = {}): ReturnType<typeof vi.fn> {
  localStorage.setItem(
    'vastaflow.session',
    JSON.stringify({ token: 'jwt-guardado', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
  const fetchMock = mockApi({
    'GET /auth/me': { status: 200, body: me },
    'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
    'GET /dashboard/summary': { status: 200, body: {} },
    'GET /users/alvo': { status: 200, body: ALVO },
    'GET /users/assignable-roles': {
      status: 200,
      body: me.role === 'ADMIN' ? ['ADMIN', 'GESTOR', 'OPERADOR', 'USUARIO'] : ['USUARIO'],
    },
    [ROTAS.links]: { status: 200, body: [LINK] },
    [ROTAS.requests]: { status: 200, body: [] },
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={['/users/alvo']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

const secao = (): Promise<HTMLElement> =>
  screen.findByRole('heading', { name: 'Vínculos externos' });

/** A tabela sob o subtítulo informado. */
async function tabelaDe(titulo: string): Promise<HTMLElement> {
  const cabecalho = await screen.findByRole('heading', { name: titulo });
  const tabela = cabecalho.nextElementSibling?.querySelector('table');
  if (!tabela) {
    throw new Error(`tabela de "${titulo}" nao encontrada`);
  }
  return tabela;
}

function chamadas(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit][] {
  return fetchMock.mock.calls as [string, RequestInit][];
}

function chamadasDe(fetchMock: ReturnType<typeof vi.fn>, rota: string): [string, RequestInit][] {
  const [metodo, caminho] = rota.split(' ');
  return chamadas(fetchMock).filter(
    ([url, init]) => (init.method ?? 'GET') === metodo && new URL(url).pathname === caminho,
  );
}

describe('Vinculos externos no detalhe do usuario', () => {
  describe('a secao no detalhe', () => {
    it('aparece no detalhe do usuario', async () => {
      renderDetalhe(ADMIN);

      expect(await secao()).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Vínculos ativos' })).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { name: 'Solicitações pendentes' }),
      ).toBeInTheDocument();
    });

    it('distingue solicitacao pendente de vinculo ativo, com titulos proprios', async () => {
      renderDetalhe(ADMIN, { [ROTAS.requests]: { status: 200, body: [PENDENTE] } });
      await secao();

      const ativos = await tabelaDe('Vínculos ativos');
      const pendentes = await tabelaDe('Solicitações pendentes');

      expect(within(ativos).getByText('123456789')).toBeInTheDocument();
      expect(within(pendentes).getByText('Pendente')).toBeInTheDocument();
      // O identificador do vinculo ativo nao aparece entre as pendentes.
      expect(within(pendentes).queryByText('123456789')).not.toBeInTheDocument();
    });
  });

  describe('carregamento', () => {
    it('mostra o estado de carregamento antes das respostas', async () => {
      renderDetalhe(ADMIN, {
        [ROTAS.links]: () =>
          new Promise<Reply>((resolve) => {
            setTimeout(() => {
              resolve({ status: 200, body: [LINK] });
            }, 30);
          }),
      });

      expect(await screen.findByText('Carregando vínculos externos…')).toBeInTheDocument();
      expect(await screen.findByText('123456789')).toBeInTheDocument();
    });

    it('carrega os vinculos ativos com canal, identificador e data', async () => {
      renderDetalhe(ADMIN);
      const ativos = await tabelaDe('Vínculos ativos');

      expect(within(ativos).getByText('Telegram')).toBeInTheDocument();
      expect(within(ativos).getByText('123456789')).toBeInTheDocument();
      expect(within(ativos).getByText(/20\/09\/2026/)).toBeInTheDocument();
    });

    it('carrega as solicitacoes pendentes com canal, situacao e validade', async () => {
      renderDetalhe(ADMIN, { [ROTAS.requests]: { status: 200, body: [PENDENTE] } });
      const pendentes = await tabelaDe('Solicitações pendentes');

      expect(within(pendentes).getByText('Telegram')).toBeInTheDocument();
      expect(within(pendentes).getByText('Pendente')).toBeInTheDocument();
      expect(within(pendentes).getByText(/Válida até/)).toBeInTheDocument();
    });

    it('solicitacao com prazo vencido e mostrada como vencida, sem inventar status', async () => {
      renderDetalhe(ADMIN, {
        [ROTAS.requests]: {
          status: 200,
          body: [{ ...PENDENTE, expiraEm: '2020-01-01T10:15:00.000Z' }],
        },
      });
      const pendentes = await tabelaDe('Solicitações pendentes');

      // O status segue sendo o do backend; só a data informa o vencimento.
      expect(within(pendentes).getByText('Pendente')).toBeInTheDocument();
      expect(within(pendentes).getByText(/Venceu em/)).toBeInTheDocument();
    });

    it('estado vazio nas duas listas', async () => {
      renderDetalhe(ADMIN, { [ROTAS.links]: { status: 200, body: [] } });
      await secao();

      expect(await screen.findByText('Nenhuma conta externa vinculada.')).toBeInTheDocument();
      expect(screen.getByText('Nenhuma solicitação pendente.')).toBeInTheDocument();
    });

    it('erro de carregamento mostra alerta e permite tentar de novo', async () => {
      let tentativas = 0;
      renderDetalhe(ADMIN, {
        [ROTAS.links]: () => {
          tentativas += 1;
          return tentativas === 1 ? { status: 500, body: {} } : { status: 200, body: [LINK] };
        },
      });

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar os vínculos externos.');

      await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByText('123456789')).toBeInTheDocument();
    });
  });

  describe('iniciar vinculacao', () => {
    it('oferece apenas o Telegram, sem nenhum outro canal', async () => {
      renderDetalhe(ADMIN);
      await secao();

      expect(await screen.findByRole('button', { name: 'Vincular Telegram' })).toBeInTheDocument();
      for (const inexistente of [/WhatsApp/i, /e-?mail/i, /Plantae/i, /SMS/i]) {
        expect(screen.queryByRole('button', { name: inexistente })).not.toBeInTheDocument();
      }
    });

    it('envia somente o canal, sem idExterno nem usuario no corpo', async () => {
      const fetchMock = renderDetalhe(ADMIN, { [ROTAS.criar]: { status: 201, body: CRIADA } });
      await secao();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));

      await waitFor(() => {
        expect(chamadasDe(fetchMock, ROTAS.criar)).toHaveLength(1);
      });
      const enviado = chamadasDe(fetchMock, ROTAS.criar)[0][1].body;
      if (typeof enviado !== 'string') {
        throw new Error('o POST de solicitacao deveria levar um corpo JSON');
      }
      const corpo = JSON.parse(enviado) as Record<string, unknown>;
      expect(corpo).toEqual({ canal: 'telegram' });
      for (const proibido of ['idExterno', 'usuarioId', 'userId', 'id', 'codigo']) {
        expect(corpo).not.toHaveProperty(proibido);
      }
    });

    it('nao ha endpoint de WhatsApp em nenhuma chamada', async () => {
      const fetchMock = renderDetalhe(ADMIN, { [ROTAS.criar]: { status: 201, body: CRIADA } });
      await secao();
      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));
      await screen.findByText(CRIADA.codigo);

      const urls = chamadas(fetchMock).map(([url]) => url);
      expect(urls.some((url) => /whatsapp|email|sms/i.test(url))).toBe(false);
    });

    it('o botao fica desabilitado enquanto a solicitacao esta sendo criada', async () => {
      let concluir: (reply: Reply) => void = () => undefined;
      const fetchMock = renderDetalhe(ADMIN, {
        [ROTAS.criar]: () =>
          new Promise<Reply>((resolve) => {
            concluir = resolve;
          }),
      });
      await secao();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));
      expect(screen.getByRole('button', { name: 'Criando…' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Criando…' }));

      concluir({ status: 201, body: CRIADA });

      await waitFor(() => {
        expect(chamadasDe(fetchMock, ROTAS.criar)).toHaveLength(1);
      });
    });
  });

  describe('codigo de confirmacao', () => {
    it('nao aparece antes de a solicitacao ser criada', async () => {
      renderDetalhe(ADMIN, { [ROTAS.requests]: { status: 200, body: [PENDENTE] } });
      await secao();
      await tabelaDe('Solicitações pendentes');

      expect(screen.queryByText(CRIADA.codigo)).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('aparece depois da criacao, num dialogo com titulo e validade', async () => {
      renderDetalhe(ADMIN, { [ROTAS.criar]: { status: 201, body: CRIADA } });
      await secao();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));

      const dialogo = await screen.findByRole('dialog');
      expect(
        within(dialogo).getByRole('heading', { name: 'Vinculação do Telegram' }),
      ).toBeInTheDocument();
      expect(within(dialogo).getByText(CRIADA.codigo)).toBeInTheDocument();
      // A instrucao vem do backend; a tela nao a reescreve.
      expect(within(dialogo).getByText(CRIADA.instrucao)).toBeInTheDocument();
      expect(
        within(dialogo).getByText(/pela própria conta que será vinculada/),
      ).toBeInTheDocument();
      expect(within(dialogo).getByText(/não será mostrado novamente/)).toBeInTheDocument();
      // Validade, a partir de `expiraEm`.
      expect(within(dialogo).getByText(/01\/01\/2099/)).toBeInTheDocument();
    });

    it('nao fica persistido em storage, URL nem historico', async () => {
      renderDetalhe(ADMIN, { [ROTAS.criar]: { status: 201, body: CRIADA } });
      await secao();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));
      await screen.findByText(CRIADA.codigo);

      expect(JSON.stringify(localStorage)).not.toContain(CRIADA.codigo);
      expect(JSON.stringify(sessionStorage)).not.toContain(CRIADA.codigo);
      expect(window.location.href).not.toContain(CRIADA.codigo);
      expect(window.location.search).toBe('');
    });

    it('desaparece ao fechar o dialogo, e nao volta', async () => {
      renderDetalhe(ADMIN, {
        [ROTAS.criar]: { status: 201, body: CRIADA },
        [ROTAS.requests]: { status: 200, body: [PENDENTE] },
      });
      await secao();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));
      await screen.findByText(CRIADA.codigo);
      await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));

      await waitFor(() => {
        expect(screen.queryByText(CRIADA.codigo)).not.toBeInTheDocument();
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('a solicitacao pendente aparece depois de fechar o dialogo', async () => {
      let criada = false;
      renderDetalhe(ADMIN, {
        [ROTAS.criar]: () => {
          criada = true;
          return { status: 201, body: CRIADA };
        },
        [ROTAS.requests]: () => ({ status: 200, body: criada ? [PENDENTE] : [] }),
      });
      await secao();
      expect(await screen.findByText('Nenhuma solicitação pendente.')).toBeInTheDocument();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));
      await screen.findByText(CRIADA.codigo);
      await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Solicitação criada.');
      const pendentes = await tabelaDe('Solicitações pendentes');
      expect(within(pendentes).getByText('Pendente')).toBeInTheDocument();
    });

    it('nenhum token, hash ou dado interno aparece na tela', async () => {
      renderDetalhe(ADMIN, { [ROTAS.criar]: { status: 201, body: CRIADA } });
      await secao();
      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));
      await screen.findByText(CRIADA.codigo);

      const texto = document.body.textContent ?? '';
      expect(texto).not.toContain('jwt-guardado');
      for (const proibido of [/\$2b\$/, /hash/i, /token/i, /select /i, /bearer/i]) {
        expect(texto).not.toMatch(proibido);
      }
    });
  });

  describe('cancelar solicitacao', () => {
    it('pede confirmacao e cancela, atualizando a lista', async () => {
      let cancelada = false;
      const fetchMock = renderDetalhe(ADMIN, {
        [ROTAS.requests]: () => ({ status: 200, body: cancelada ? [] : [PENDENTE] }),
        [ROTAS.cancelar]: () => {
          cancelada = true;
          return { status: 204 };
        },
      });
      const pendentes = await tabelaDe('Solicitações pendentes');

      await userEvent.click(within(pendentes).getByRole('button', { name: 'Cancelar' }));
      const dialogo = await screen.findByRole('dialog');
      expect(
        within(dialogo).getByRole('heading', { name: 'Cancelar solicitação?' }),
      ).toBeInTheDocument();
      await userEvent.click(
        within(dialogo).getByRole('button', { name: 'Confirmar cancelamento' }),
      );

      expect(await screen.findByRole('status')).toHaveTextContent('Solicitação cancelada.');
      expect(await screen.findByText('Nenhuma solicitação pendente.')).toBeInTheDocument();
      expect(chamadasDe(fetchMock, ROTAS.cancelar)).toHaveLength(1);
    });

    it('fechar a confirmacao nao cancela nada', async () => {
      const fetchMock = renderDetalhe(ADMIN, {
        [ROTAS.requests]: { status: 200, body: [PENDENTE] },
      });
      const pendentes = await tabelaDe('Solicitações pendentes');

      await userEvent.click(within(pendentes).getByRole('button', { name: 'Cancelar' }));
      await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));

      expect(chamadasDe(fetchMock, ROTAS.cancelar)).toHaveLength(0);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('remover vinculo', () => {
    it('pede confirmacao antes de remover', async () => {
      const fetchMock = renderDetalhe(ADMIN);
      const ativos = await tabelaDe('Vínculos ativos');

      await userEvent.click(within(ativos).getByRole('button', { name: 'Remover' }));

      const dialogo = await screen.findByRole('dialog');
      expect(
        within(dialogo).getByRole('heading', { name: 'Remover vínculo externo?' }),
      ).toBeInTheDocument();
      expect(chamadasDe(fetchMock, ROTAS.remover)).toHaveLength(0);
    });

    it('remove e atualiza a lista de vinculos ativos', async () => {
      let removido = false;
      const fetchMock = renderDetalhe(ADMIN, {
        [ROTAS.links]: () => ({ status: 200, body: removido ? [] : [LINK] }),
        [ROTAS.remover]: () => {
          removido = true;
          return { status: 204 };
        },
      });
      const ativos = await tabelaDe('Vínculos ativos');

      await userEvent.click(within(ativos).getByRole('button', { name: 'Remover' }));
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Confirmar remoção',
        }),
      );

      expect(await screen.findByRole('status')).toHaveTextContent('removido');
      expect(await screen.findByText('Nenhuma conta externa vinculada.')).toBeInTheDocument();
      expect(chamadasDe(fetchMock, ROTAS.remover)).toHaveLength(1);
    });

    it('duplo clique na confirmacao dispara apenas uma requisicao', async () => {
      let concluir: (reply: Reply) => void = () => undefined;
      const fetchMock = renderDetalhe(ADMIN, {
        [ROTAS.remover]: () =>
          new Promise<Reply>((resolve) => {
            concluir = resolve;
          }),
      });
      const ativos = await tabelaDe('Vínculos ativos');

      await userEvent.click(within(ativos).getByRole('button', { name: 'Remover' }));
      const dialogo = await screen.findByRole('dialog');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar remoção' }));
      // Enquanto a requisicao corre, a confirmacao mostra "Aguarde…" desabilitado.
      expect(within(dialogo).getByRole('button', { name: 'Aguarde…' })).toBeDisabled();
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Aguarde…' }));

      concluir({ status: 204 });

      await waitFor(() => {
        expect(chamadasDe(fetchMock, ROTAS.remover)).toHaveLength(1);
      });
    });
  });

  describe('erros da API', () => {
    it('403 informa falta de permissao, sem mascarar como sucesso', async () => {
      renderDetalhe(ADMIN, {
        [ROTAS.remover]: { status: 403, body: { message: 'sem permissao' } },
      });
      const ativos = await tabelaDe('Vínculos ativos');

      await userEvent.click(within(ativos).getByRole('button', { name: 'Remover' }));
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Confirmar remoção',
        }),
      );

      const alertas = await screen.findAllByRole('alert');
      expect(alertas.some((a) => a.textContent?.includes('não tem permissão'))).toBe(true);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      // O vinculo continua na tela: nada foi removido.
      expect(screen.getByText('123456789')).toBeInTheDocument();
    });

    it('404 avisa que o item nao existe mais', async () => {
      renderDetalhe(ADMIN, {
        [ROTAS.requests]: { status: 200, body: [PENDENTE] },
        [ROTAS.cancelar]: { status: 404, body: { message: 'nao encontrada' } },
      });
      const pendentes = await tabelaDe('Solicitações pendentes');

      await userEvent.click(within(pendentes).getByRole('button', { name: 'Cancelar' }));
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Confirmar cancelamento',
        }),
      );

      const alertas = await screen.findAllByRole('alert');
      expect(alertas.some((a) => a.textContent?.includes('não foi encontrado'))).toBe(true);
    });

    it('409 na criacao explica o conflito sem expor detalhe interno', async () => {
      renderDetalhe(ADMIN, {
        [ROTAS.criar]: {
          status: 409,
          body: { message: 'Ja existe uma solicitacao pendente para este usuario' },
        },
      });
      await secao();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));

      const alertas = await screen.findAllByRole('alert');
      expect(alertas.some((a) => a.textContent?.includes('já existe uma pendente'))).toBe(true);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('401 encerra a sessao e leva ao login', async () => {
      renderDetalhe(ADMIN, {
        [ROTAS.criar]: { status: 401, body: { message: 'expirado' } },
        'POST /auth/logout': { status: 204 },
      });
      await secao();

      await userEvent.click(await screen.findByRole('button', { name: 'Vincular Telegram' }));

      expect(await screen.findByText('Entre com sua conta para continuar.')).toBeInTheDocument();
    });
  });

  describe('permissoes', () => {
    it('quem nao pode editar o usuario ve as listas, mas nenhuma acao', async () => {
      renderDetalhe(SO_LEITURA, { [ROTAS.requests]: { status: 200, body: [PENDENTE] } });
      await secao();

      // As duas listas continuam visiveis...
      expect(await screen.findByText('123456789')).toBeInTheDocument();
      expect(screen.getByText('Pendente')).toBeInTheDocument();
      // ...e nenhuma acao protegida e oferecida.
      expect(screen.queryByRole('button', { name: 'Vincular Telegram' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    });

    it('a coluna de acoes nem aparece para quem nao pode editar', async () => {
      renderDetalhe(SO_LEITURA);
      const ativos = await tabelaDe('Vínculos ativos');

      expect(within(ativos).queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument();
    });

    it('quem pode editar recebe as acoes', async () => {
      renderDetalhe(ADMIN, { [ROTAS.requests]: { status: 200, body: [PENDENTE] } });
      await secao();

      expect(await screen.findByRole('button', { name: 'Vincular Telegram' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remover' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    });
  });
});
