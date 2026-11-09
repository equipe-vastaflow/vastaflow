import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { currentMonthPeriod } from './plantae-format';
import {
  callsTo,
  consultar,
  expectNothingStored,
  list,
  makeMovement,
  mockApi,
  openTab,
  PLANTAE,
  RIZOLA,
  session,
  setDate,
} from './plantae-test-support';

const ABA = 'Movimentações';

const linha = async (texto: string): Promise<HTMLElement> =>
  (await screen.findByText(texto)).closest('tr') as HTMLElement;

describe('aba Movimentações', () => {
  it('abrir a aba nao consulta; padrao: mes corrente, 50 por pagina, uma pagina, sem cache', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.movements]: { status: 200, body: list([]) } }),
    );
    await openTab(ABA);
    await screen.findByRole('button', { name: 'Consultar' });
    expect(callsTo(fetchMock, PLANTAE.movements)).toHaveLength(0);

    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.movements)).toHaveLength(1);
    });
    const [{ url, init }] = callsTo(fetchMock, PLANTAE.movements) as [
      { url: URL; init: RequestInit },
    ];
    const { de, ate } = currentMonthPeriod();
    expect(Object.fromEntries(url.searchParams)).toEqual({
      data_inicio: de,
      data_fim: ate,
      per_page: '50',
      paginas: '1',
    });
    expect(init.cache).toBe('no-store');
  });

  it.each([
    ['C', 'true', { natureza: 'C', conciliado: 'true' }],
    ['D', 'false', { natureza: 'D', conciliado: 'false' }],
  ])('natureza %s e conciliado %s chegam ao backend', async (natureza, conciliado, esperado) => {
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.movements]: { status: 200, body: list([]) } }),
    );
    await openTab(ABA);

    await userEvent.selectOptions(await screen.findByLabelText('Natureza'), natureza);
    await userEvent.selectOptions(screen.getByLabelText('Conciliação'), conciliado);
    setDate('De', '2026-11-01');
    setDate('Até', '2026-11-08');
    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.movements)).toHaveLength(1);
    });
    expect(
      Object.fromEntries(callsTo(fetchMock, PLANTAE.movements)[0]?.url.searchParams ?? []),
    ).toEqual({
      data_inicio: '2026-11-01',
      data_fim: '2026-11-08',
      per_page: '50',
      paginas: '1',
      ...esperado,
    });
  });

  it('mostra data, conta, entrada/saida, descricao, pessoa mascarada, valor e conciliacao', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.movements]: {
          status: 200,
          body: list([
            makeMovement(),
            makeMovement({
              mov_conta_id: 2961,
              natureza: { codigo: 'C', descricao: 'Credito' },
              valor: '250',
              descricao: 'Recebimento ficticio',
              conciliado: true,
              data_conciliacao: '2026-11-05',
            }),
          ]),
        },
      }),
    );
    await openTab(ABA);
    await consultar();

    const saida = await linha('Pagamento ficticio');
    expect(within(saida).getByText('02/11/2026')).toBeInTheDocument();
    expect(within(saida).getByText('Conta Ficticia')).toBeInTheDocument();
    expect(within(saida).getByText('Saída')).toBeInTheDocument();
    expect(within(saida).getByText('Fornecedor Ficticio')).toBeInTheDocument();
    expect(within(saida).getByText('12.345.678/****-**')).toBeInTheDocument();
    expect(within(saida).getByText('1.503,20')).toBeInTheDocument();
    expect(within(saida).getByText('Não conciliado')).toBeInTheDocument();

    const entrada = await linha('Recebimento ficticio');
    expect(within(entrada).getByText('Entrada')).toBeInTheDocument();
    expect(within(entrada).getByText('250,00')).toBeInTheDocument();
    expect(within(entrada).getByText('Conciliado em 05/11/2026')).toBeInTheDocument();
  });

  it('nao presume moeda e avisa sobre estornos e cartao de credito', async () => {
    mockApi(
      session(RIZOLA, { [PLANTAE.movements]: { status: 200, body: list([makeMovement()]) } }),
    );
    await openTab(ABA);

    expect(
      await screen.findByText(/não inclui movimentos estornados nem compras no cartão de crédito/),
    ).toBeInTheDocument();
    await consultar();
    await linha('Pagamento ficticio');

    expect(screen.getByRole('table')).not.toHaveTextContent('R$');
  });

  it('documento que chegasse sem mascara nao aparece', async () => {
    const pessoa = { ...makeMovement().pessoa!, cpf_cnpj: '12.345.678/0001-95' };
    mockApi(
      session(RIZOLA, {
        [PLANTAE.movements]: { status: 200, body: list([makeMovement({ pessoa })]) },
      }),
    );
    await openTab(ABA);
    await consultar();

    await linha('Pagamento ficticio');
    expect(screen.queryByText('12.345.678/0001-95')).not.toBeInTheDocument();
  });

  it('"Carregar mais" usa o cursor com os filtros originais', async () => {
    const respostas = [
      list([makeMovement({ descricao: 'Primeira' })], { nextCursor: 'mov-2', hasMore: true }),
      list([makeMovement({ mov_conta_id: 2, descricao: 'Segunda' })]),
    ];
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.movements]: () => ({ status: 200, body: respostas.shift() }) }),
    );
    await openTab(ABA);
    await userEvent.selectOptions(await screen.findByLabelText('Natureza'), 'D');
    await consultar();
    await screen.findByText('Primeira');

    await userEvent.selectOptions(screen.getByLabelText('Natureza'), 'C');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Segunda')).toBeInTheDocument();
    expect(screen.getByText('Primeira')).toBeInTheDocument();
    const [primeira, segunda] = callsTo(fetchMock, PLANTAE.movements);
    expect(Object.fromEntries(segunda?.url.searchParams ?? [])).toEqual({
      ...Object.fromEntries(primeira?.url.searchParams ?? []),
      cursor: 'mov-2',
    });
    expect(segunda?.url.searchParams.get('natureza')).toBe('D');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('periodo invalido nao consulta', async () => {
    const fetchMock = mockApi(session(RIZOLA));
    await openTab(ABA);
    await screen.findByRole('button', { name: 'Consultar' });

    setDate('De', '2026-11-08');
    setDate('Até', '2026-11-01');
    await consultar();

    expect(
      await screen.findByText('A data inicial não pode ser posterior à final.'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, PLANTAE.movements)).toHaveLength(0);
  });

  it('erro do Plantae vira mensagem amigavel, sem o texto bruto', async () => {
    const bruto = 'PLANTAE_UPSTREAM_ERROR: O Plantae esta com problemas para responder';
    mockApi(session(RIZOLA, { [PLANTAE.movements]: { status: 424, body: { message: bruto } } }));
    await openTab(ABA);
    await consultar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O Plantae está com problemas para responder.',
    );
    expect(screen.queryByText(bruto)).not.toBeInTheDocument();
  });

  it('nada vai para localStorage ou sessionStorage', async () => {
    mockApi(
      session(RIZOLA, { [PLANTAE.movements]: { status: 200, body: list([makeMovement()]) } }),
    );
    await openTab(ABA);
    await consultar();
    await linha('Pagamento ficticio');

    expectNothingStored(['Pagamento ficticio', 'Fornecedor Ficticio', '1503.20']);
  });
});
