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

describe('rota publica /privacidade', () => {
  it('abre sem login, sem chamar a API e sem redirecionar', () => {
    const fetchMock = mockApi({});
    renderAt('/privacidade');
    expect(screen.getByRole('heading', { name: 'Política de Privacidade', level: 1 })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
  });

  it('abre mesmo com sessao expirada guardada', async () => {
    mockApi({ 'GET /auth/me': { status: 401 } });
    storeSession(Date.now() - 1000);
    renderAt('/privacidade');
    expect(screen.getByRole('heading', { name: 'Política de Privacidade', level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    });
  });

  it('cobre os temas exigidos e nao expoe marcadores internos nem aviso de revisao', () => {
    mockApi({});
    renderAt('/privacidade');
    for (const name of [/Quem somos/, /Dados pessoais tratados/, /WhatsApp e Meta/, /Segurança/, /Seus direitos/, /Contato sobre privacidade/]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Vasta Participações Empreendimentos e Agropecuária Ltda\./)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-pending="true"]')).toHaveLength(0);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/A CONFIRMAR|Versão em revisão|não é definitivo/);
  });
});

describe('/privacidade: descricao fiel ao estado operacional', () => {
  it('nao apresenta backup nem respostas do WhatsApp como comprovados e cita Hostinger, wa_id e n8n', () => {
    mockApi({});
    renderAt('/privacidade');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Hostinger, como provedora terceirizada/);
    expect(text).toMatch(/ainda não foram comprovadas em operação/);
    expect(text).toMatch(/wa_id/);
    expect(text).toMatch(/por alguns minutos antes de ser apagado/);
    expect(text).not.toMatch(/removido em segundos/);
    expect(text).toMatch(/Conexão protegida por HTTPS/);
    const medidas = screen.getByRole('heading', { name: /Segurança/ }).parentElement?.querySelector('ul');
    expect(medidas?.textContent).not.toMatch(/Cópias de segurança/);
  });
});

describe('/privacidade: Plantae ativo, descrito como realmente funciona', () => {
  const texto = (): string => {
    mockApi({});
    renderAt('/privacidade');
    return document.body.textContent ?? '';
  };

  it('nao diz mais que o Plantae esta desligado; a NFS-e continua desligada', () => {
    const text = texto();
    expect(text).not.toMatch(/consulta\s+à Plantae existem no código/);
    expect(text).not.toMatch(/Plantae[^.]*desligad/);
    expect(text).toMatch(/nota fiscal de serviço \(NFS-e\) existem no código, mas estão desligados/);
    expect(screen.getByRole('heading', { name: '3.5 Consultas ao Plantae' })).toBeInTheDocument();
  });

  it('consulta em tempo real, somente leitura, so para usuarios autorizados', () => {
    const text = texto();
    expect(text).toMatch(/consulta o Plantae em tempo real e somente para leitura/);
    expect(text).toMatch(/não cria, altera nem exclui informações no Plantae/);
    expect(text).toMatch(/apenas a usuários com permissão específica/);
    expect(text).toMatch(/nomes de pessoas e empresas \(clientes, fornecedores e colaboradores\)/);
  });

  it('CPF/CNPJ e contas mascarados pelo servidor; armazenamento descrito sem afirmacao absoluta', () => {
    const text = texto();
    expect(text).toMatch(/CPF, CNPJ e números de contas bancárias são exibidos mascarados/);
    expect(text).toMatch(/feito pelo servidor do VastaFlow, antes de a informação chegar ao navegador/);
    expect(text).toMatch(
      /O VastaFlow não armazena os resultados das consultas financeiras em suas tabelas operacionais\. Os registros de auditoria são mantidos separadamente\. As informações transmitidas pelos canais de mensagens também estão sujeitas ao tratamento e à retenção técnica descritos nesta política\./,
    );
    expect(text).toMatch(/sem armazenamento dos resultados nas tabelas operacionais do sistema/);
    expect(text).not.toMatch(/não são gravadas no banco de dados|sem gravação das informações consultadas/);
    expect(text).toMatch(/não serem guardadas em cache/);
  });

  it('comandos de chat: resumo sem CPF/CNPJ nem nome de clientes; fornecedor so por configuracao', () => {
    const text = texto();
    expect(text).toMatch(/sem CPF\/CNPJ e sem o nome de clientes/);
    expect(text).toMatch(/na configuração atual, ela está desativada/);
  });

  it('Telegram: nunca afirma criptografia de ponta a ponta', () => {
    const text = texto();
    expect(text).toMatch(/não são protegidas por criptografia de ponta a ponta/);
    expect(text).not.toMatch(/(?<!não são protegidas por )criptografia de ponta a ponta/);
  });

  it('n8n: a resposta passa por ele, gravacao transitoria, sem prometer retencao zero', () => {
    const text = texto();
    expect(text).toMatch(/a resposta do sistema também passa por ele/);
    expect(text).toMatch(/grava temporariamente, no seu banco de dados interno/);
    expect(text).toMatch(/Resquícios técnicos podem permanecer/);
    expect(text).not.toMatch(/retenção zero|nunca é gravad|não fica registrad|removido em segundos/i);
  });

  it('auditoria distinta dos dados consultados; Plantae entre os compartilhamentos', () => {
    const text = texto();
    expect(text).toMatch(/Esses registros são distintos das informações consultadas/);
    expect(text).toMatch(/não guardam valores, nomes, documentos nem os termos de busca/);
    const compartilhamento = screen.getByRole('heading', { name: /Compartilhamento/ }).parentElement;
    expect(compartilhamento).toHaveTextContent(/Plantae, sistema de gestão financeira utilizado pela Vasta/);
  });
});

describe('/privacidade: identificacao da versao', () => {
  it('a versao atual esta pendente de aprovacao, sem data de aprovacao inventada', () => {
    mockApi({});
    renderAt('/privacidade');
    const cabecalho = document.querySelector('.policy-header')?.textContent ?? '';
    expect(cabecalho).toMatch(/Atualização pendente de aprovação\./);
    expect(cabecalho).toMatch(/ainda não foi aprovada pela Vasta/);
    // Nenhuma data aparece associada a versao atual: so a da versao anterior.
    expect(cabecalho.match(/\d{2}\/\d{2}\/\d{4}/g)).toEqual(['28/10/2026', '28/10/2026']);
  });

  it('a aprovacao de 28/10/2026 por Rizola e atribuida SO a versao anterior', () => {
    mockApi({});
    renderAt('/privacidade');
    const paragrafos = [...document.querySelectorAll('.policy-header p')].map((p) => p.textContent ?? '');
    const comAprovacao = paragrafos.filter((p) => /aprovado em 28\/10\/2026 por Rizola/.test(p));
    expect(comAprovacao).toHaveLength(1);
    expect(comAprovacao[0]).toMatch(/^Versão anterior: data de vigência 28\/10\/2026/);
    expect(document.body.textContent).not.toMatch(/^Data de vigência: 28\/10\/2026/m);
  });
});

describe('/privacidade: dados confirmados pela empresa', () => {
  it('traz CNPJ, endereco, titulares, vigencia aprovada e responsavel pelo contato', () => {
    mockApi({});
    renderAt('/privacidade');
    const text = document.body.textContent ?? '';
    expect(text).toContain('07.131.218/0001-24');
    expect(text).toContain('Estrada Municipal de Morada Nova de Minas, Zona Rural');
    expect(text).toContain('CEP 35.628-000');
    expect(text).toMatch(/sócios e funcionários/);
    expect(text).toMatch(/clientes, fornecedores e colaboradores/);
    expect(text).not.toMatch(/vigência proposta|condicionada/);
    expect(text).toMatch(/Responsável indicada pela Vasta para o contato sobre privacidade: Rizola/);
  });

  it('nao inventa e-mail e declara, sem marcador, as tres pendencias juridicas abertas', () => {
    mockApi({});
    renderAt('/privacidade');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/@/);
    expect(text).toMatch(/base legal específica de cada finalidade ainda está em validação jurídica/);
    expect(text).toMatch(/validação jurídica das obrigações de retenção e a definição dos prazos internos ainda estão pendentes/);
    expect(text).toMatch(/análise jurídica sobre eventual transferência internacional[\s\S]{0,200}ainda não foi concluída/);
    expect(text).not.toMatch(/A CONFIRMAR/);
  });

  it('nao apresenta exclusao automatica, backup externo nem resposta do WhatsApp como operacionais', () => {
    mockApi({});
    renderAt('/privacidade');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/A exclusão definitiva não é automática e não está implementada atualmente/);
    expect(text).toMatch(/Google Drive\): a decisão foi adiada/);
    expect(text).toMatch(/não é apresentada aqui como medida em operação/);
    expect(text).toMatch(/ainda não foram comprovadas em operação/);
  });
});

describe('/privacidade: canal de contato por WhatsApp', () => {
  it('mostra o numero e o link wa.me, identificados como canal de protecao de dados', () => {
    mockApi({});
    renderAt('/privacidade');
    const section = screen.getByRole('heading', { name: /Contato sobre privacidade/ }).parentElement;
    expect(section).toHaveTextContent('+55 31 9886-1100');
    expect(section).toHaveTextContent(/solicitações relacionadas à proteção de dados pessoais/);
    const link = screen.getByRole('link', { name: 'abrir conversa no WhatsApp' });
    expect(link).toHaveAttribute('href', 'https://wa.me/553198861100');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('contato: sem marcadores, sem DPO formal e sem prazo fixo inventado', () => {
    mockApi({});
    renderAt('/privacidade');
    const section = screen.getByRole('heading', { name: /Contato sobre privacidade/ }).parentElement;
    expect(section?.querySelectorAll('[data-pending="true"]')).toHaveLength(0);
    expect(section).toHaveTextContent(/não designa formalmente a função de encarregada/);
    expect(section).toHaveTextContent(/prazos previstos na legislação aplicável/);
    expect(section?.textContent).not.toMatch(/[0-9]+ *(dias|horas)/);
  });
});

describe('/privacidade: redacoes provisorias', () => {
  it('retencao, desligados, terceiros e transferencia usam a redacao verdadeira', () => {
    mockApi({});
    renderAt('/privacidade');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Não existem prazos internos de retenção definidos/);
    expect(text).toMatch(/finalidades do tratamento e eventuais obrigações legais aplicáveis/);
    expect(text).toMatch(/usuários desligados podem ser desativados/);
    expect(text).toMatch(/conforme o conteúdo inserido pelos usuários/);
    expect(text).toMatch(/A Meta e o Telegram podem tratar dados fora do Brasil/);
    expect(text).toMatch(/ainda não foi concluída/);
  });

  it('nao atribui base legal nem apresenta as pendencias juridicas como resolvidas', () => {
    mockApi({});
    renderAt('/privacidade');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/legítimo interesse|execução de contrato|consentimento do titular como base|Estados Unidos|Lituânia/i);
    expect(text).toMatch(/não é apresentada nesta versão/);
    expect(text).toMatch(/quando forem concluídas a validação jurídica das bases legais/);
  });
});

describe('/privacidade: datacenter confirmado', () => {
  it('informa Campinas/SP/Brasil na hospedagem e no armazenamento, sem marcador', () => {
    mockApi({});
    renderAt('/privacidade');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Localização do datacenter: Campinas, São Paulo, Brasil/);
    expect(text).toMatch(/datacenter fica em Campinas, São Paulo, Brasil/);
    expect(text).not.toMatch(/País do datacenter/);
    expect(document.querySelectorAll('[data-pending="true"]')).toHaveLength(0);
  });
});
