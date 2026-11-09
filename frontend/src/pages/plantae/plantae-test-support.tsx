import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../../App';
import type {
  PlantaeAccount,
  PlantaeList,
  PlantaeMovement,
  PlantaePagination,
  PlantaePerson,
  RoleName,
  User,
} from '../../api/client';
import { AuthProvider } from '../../auth/AuthContext';

/*
 * Apoio dos testes do painel Plantae: `fetch` simulado, usuarios e navegacao.
 * Nenhum dado real: nomes, documentos (ja mascarados) e valores sao ficticios.
 */

export type Reply = { status: number; body?: unknown };
export type Handler = Reply | ((url: URL, init: RequestInit | undefined) => Reply | Promise<Reply>);

export const PLANTAE = {
  entries: 'GET /integrations/plantae/financial/entries',
  movements: 'GET /integrations/plantae/financial/movements',
  accounts: 'GET /integrations/plantae/financial/accounts',
  statement: 'GET /integrations/plantae/financial/account-statement',
  people: 'GET /integrations/plantae/people',
} as const;

/** Substitui o `fetch` por respostas indexadas por "METODO /caminho" (sem query string). */
export function mockApi(routes: Record<string, Handler>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) {
      throw new TypeError(`fetch nao mockado: ${key}`);
    }
    const reply = typeof handler === 'function' ? await handler(url, init) : handler;
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

/** Chamadas feitas a uma rota: URL completa e `init`. */
export const callsTo = (
  fetchMock: ReturnType<typeof vi.fn>,
  key: string,
): Array<{ url: URL; init: RequestInit | undefined }> =>
  fetchMock.mock.calls
    .map(([input, init]) => ({
      url: new URL(input as string),
      init: init as RequestInit | undefined,
    }))
    .filter(({ url, init }) => `${init?.method ?? 'GET'} ${url.pathname}` === key);

/** Todas as chamadas a qualquer rota do Plantae. */
export const plantaeCalls = (fetchMock: ReturnType<typeof vi.fn>): number =>
  Object.values(PLANTAE).reduce((total, key) => total + callsTo(fetchMock, key).length, 0);

export function makeUser(id: string, role: RoleName, permissions: string[]): User {
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

export const RIZOLA = makeUser('rizola', 'GESTOR', ['finance:read', 'plantae:read']);
export const GESTOR_SEM_PLANTAE = makeUser('gestor', 'GESTOR', ['finance:read']);
export const ADMIN = makeUser('admin', 'ADMIN', []);

export function list<T>(data: T[], pagination: Partial<PlantaePagination> = {}): PlantaeList<T> {
  return {
    data,
    pagination: { perPage: 50, nextCursor: null, hasMore: false, pagesFetched: 1, ...pagination },
  };
}

export function renderAt(path: string): void {
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
export function session(me: User, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'GET /auth/me': { status: 200, body: me },
    'GET /notifications/unread-count': { status: 200, body: { count: 0 } },
    'GET /dashboard/summary': { status: 200, body: {} },
    ...extra,
  };
}

/** Abre `/plantae` e vai para a aba indicada. */
export async function openTab(nome: string): Promise<void> {
  renderAt('/plantae');
  await userEvent.click(await screen.findByRole('tab', { name: nome }));
}

export const consultar = async (): Promise<void> => {
  await userEvent.click(await screen.findByRole('button', { name: 'Consultar' }));
};

export const setDate = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

/** Nada do navegador guarda os textos informados (so a sessao existe). */
export function expectNothingStored(textos: string[]): void {
  expect(sessionStorage.length).toBe(0);
  expect(Object.keys(localStorage)).toEqual(['vastaflow.session']);
  const tudo = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
  for (const texto of textos) {
    expect(tudo).not.toContain(texto);
  }
}

/** Movimentacao ficticia (tambem e a linha do extrato). */
export function makeMovement(overrides: Partial<PlantaeMovement> = {}): PlantaeMovement {
  return {
    mov_conta_id: 2960,
    cheque_id: null,
    data: '2026-11-02',
    natureza: { codigo: 'D', descricao: 'Debito' },
    valor: '1503.20',
    conta: { conta_id: 1496, nome: 'Conta Ficticia', tipo: { codigo: 2, descricao: 'Bancaria' } },
    origem: { codigo: 1, descricao: 'Parcela' },
    descricao: 'Pagamento ficticio',
    forma_pagamento: null,
    numero_cheque: null,
    pessoa: {
      pessoa_id: 6990,
      nome: 'Fornecedor Ficticio',
      razao_social: null,
      tipo_pessoa: 'J',
      cpf_cnpj: '12.345.678/****-**',
    },
    titulo_id: 352,
    parcela_id: 1211,
    conta_contrapartida: null,
    conciliado: false,
    data_conciliacao: null,
    saldo: null,
    ...overrides,
  };
}

/** Conta ficticia, com o numero ja mascarado como o backend devolve. */
export function makeAccount(overrides: Partial<PlantaeAccount> = {}): PlantaeAccount {
  return {
    conta_id: 1496,
    nome: 'Conta Ficticia',
    tipo: { codigo: 2, descricao: 'Conta bancaria' },
    banco: { banco_id: 5085, nome: 'Banco Ficticio' },
    agencia: '0001',
    numero_conta: '****7654',
    conta_bancaria_id: 8266,
    ...overrides,
  };
}

/** Cadastro ficticio, com o documento ja mascarado como o backend devolve. */
export function makePerson(overrides: Partial<PlantaePerson> = {}): PlantaePerson {
  return {
    pessoa_id: 6990,
    nome: 'Pessoa Ficticia',
    razao_social: null,
    tipo_pessoa: 'F',
    cpf_cnpj: '***.456.789-**',
    ...overrides,
  };
}
