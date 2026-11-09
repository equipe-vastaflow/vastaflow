import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  callsTo,
  consultar,
  expectNothingStored,
  list,
  makeAccount,
  mockApi,
  openTab,
  PLANTAE,
  RIZOLA,
  session,
} from './plantae-test-support';

const ABA = 'Contas bancárias';

const linha = async (texto: string): Promise<HTMLElement> =>
  (await screen.findByText(texto)).closest('tr') as HTMLElement;

describe('aba Contas bancárias', () => {
  it('abrir a aba nao consulta; sem filtro: so paginacao, sem cache', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.accounts]: { status: 200, body: list([]) } }),
    );
    await openTab(ABA);
    await screen.findByRole('button', { name: 'Consultar' });
    expect(callsTo(fetchMock, PLANTAE.accounts)).toHaveLength(0);

    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.accounts)).toHaveLength(1);
    });
    const [{ url, init }] = callsTo(fetchMock, PLANTAE.accounts) as [
      { url: URL; init: RequestInit },
    ];
    expect(Object.fromEntries(url.searchParams)).toEqual({ per_page: '50', paginas: '1' });
    expect(init.cache).toBe('no-store');
  });

  it('filtro por tipo', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.accounts]: { status: 200, body: list([]) } }),
    );
    await openTab(ABA);

    await userEvent.selectOptions(await screen.findByLabelText('Tipo de conta'), '3');
    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.accounts)).toHaveLength(1);
    });
    expect(callsTo(fetchMock, PLANTAE.accounts)[0]?.url.searchParams.getAll('tipo')).toEqual(['3']);
  });

  it('mostra nome, tipo, banco, agencia e numero mascarado', async () => {
    mockApi(session(RIZOLA, { [PLANTAE.accounts]: { status: 200, body: list([makeAccount()]) } }));
    await openTab(ABA);
    await consultar();

    const row = await linha('Conta Ficticia');
    expect(within(row).getByText('Conta bancária')).toBeInTheDocument();
    expect(within(row).getByText('Banco Ficticio')).toBeInTheDocument();
    expect(within(row).getByText('0001')).toBeInTheDocument();
    expect(within(row).getByText('****7654')).toBeInTheDocument();
  });

  it('numero de conta que chegasse sem mascara NUNCA aparece', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: {
          status: 200,
          body: list([makeAccount({ numero_conta: '98765-4' })]),
        },
      }),
    );
    await openTab(ABA);
    await consultar();

    const row = await linha('Conta Ficticia');
    expect(within(row).queryByText('98765-4')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).not.toHaveTextContent('98765');
  });

  it('tipo desconhecido usa a descricao da API; sem banco mostra traco', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: {
          status: 200,
          body: list([
            makeAccount({
              tipo: { codigo: 9, descricao: 'Outro tipo' },
              banco: null,
              agencia: null,
            }),
          ]),
        },
      }),
    );
    await openTab(ABA);
    await consultar();

    const row = await linha('Conta Ficticia');
    expect(within(row).getByText('Outro tipo')).toBeInTheDocument();
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  it('"Carregar mais" com cursor e o mesmo filtro', async () => {
    const respostas = [
      list([makeAccount({ nome: 'Primeira' })], { nextCursor: 'acc-2', hasMore: true }),
      list([makeAccount({ conta_id: 2, nome: 'Segunda' })]),
    ];
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.accounts]: () => ({ status: 200, body: respostas.shift() }) }),
    );
    await openTab(ABA);
    await userEvent.selectOptions(await screen.findByLabelText('Tipo de conta'), '2');
    await consultar();
    await screen.findByText('Primeira');

    await userEvent.selectOptions(screen.getByLabelText('Tipo de conta'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Segunda')).toBeInTheDocument();
    expect(screen.getByText('Primeira')).toBeInTheDocument();
    expect(
      Object.fromEntries(callsTo(fetchMock, PLANTAE.accounts)[1]?.url.searchParams ?? []),
    ).toEqual({
      per_page: '50',
      paginas: '1',
      tipo: '2',
      cursor: 'acc-2',
    });
  });

  it('429 vira mensagem amigavel com o tempo de espera', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: {
          status: 429,
          body: { message: 'PLANTAE_RATE_LIMITED: Limite atingido. Tente novamente em 12 s' },
        },
      }),
    );
    await openTab(ABA);
    await consultar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Limite de consultas ao Plantae atingido. Tente novamente em 12 s.',
    );
  });

  it('nada vai para localStorage ou sessionStorage', async () => {
    mockApi(session(RIZOLA, { [PLANTAE.accounts]: { status: 200, body: list([makeAccount()]) } }));
    await openTab(ABA);
    await consultar();
    await linha('Conta Ficticia');

    expectNothingStored(['Conta Ficticia', '****7654', 'Banco Ficticio']);
  });
});
