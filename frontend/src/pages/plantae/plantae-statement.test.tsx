import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlantaeMovement, PlantaeStatement } from '../../api/client';
import { currentMonthPeriod } from './plantae-format';
import {
  callsTo,
  consultar,
  expectNothingStored,
  list,
  makeAccount,
  makeMovement,
  mockApi,
  openTab,
  PLANTAE,
  RIZOLA,
  session,
  setDate,
} from './plantae-test-support';

const ABA = 'Extratos';

function statement(
  data: PlantaeMovement[],
  saldos: PlantaeStatement['saldos'],
  pagination: Partial<PlantaeStatement['pagination']> = {},
): PlantaeStatement {
  return { ...list(data, pagination), saldos };
}

const CONTAS = list([
  makeAccount(),
  makeAccount({
    conta_id: 1500,
    nome: 'Caixa Ficticio',
    tipo: { codigo: 1, descricao: 'Caixa' },
    numero_conta: null,
  }),
]);

async function carregarContas(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Carregar contas' }));
  await screen.findByRole('option', { name: 'Conta Ficticia · Conta bancária · ****7654' });
}

describe('aba Extratos', () => {
  it('abrir a aba nao consulta nada; sem conta nao ha extrato', async () => {
    const fetchMock = mockApi(session(RIZOLA));
    await openTab(ABA);

    expect(await screen.findByLabelText('Conta')).toBeDisabled();
    await consultar();

    expect(await screen.findByText('Selecione uma conta.')).toBeInTheDocument();
    expect(callsTo(fetchMock, PLANTAE.accounts)).toHaveLength(0);
    expect(callsTo(fetchMock, PLANTAE.statement)).toHaveLength(0);
  });

  it('"Carregar contas" lista as contas de financial/accounts, sem expor o id', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.accounts]: { status: 200, body: CONTAS } }),
    );
    await openTab(ABA);

    await carregarContas();

    const [{ url, init }] = callsTo(fetchMock, PLANTAE.accounts) as [
      { url: URL; init: RequestInit },
    ];
    expect(Object.fromEntries(url.searchParams)).toEqual({ per_page: '50', paginas: '1' });
    expect(init.cache).toBe('no-store');
    expect(screen.getByRole('option', { name: 'Caixa Ficticio · Caixa' })).toBeInTheDocument();
    expect(screen.queryByText(/1496/)).not.toBeInTheDocument();
    expect(callsTo(fetchMock, PLANTAE.statement)).toHaveLength(0);
  });

  it('consulta o extrato da conta escolhida no periodo, sem cache', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: { status: 200, body: CONTAS },
        [PLANTAE.statement]: {
          status: 200,
          body: statement([], { saldo_anterior: '0', saldo_final: '0' }),
        },
      }),
    );
    await openTab(ABA);
    await carregarContas();

    await userEvent.selectOptions(screen.getByLabelText('Conta'), '1496');
    setDate('De', '2026-11-01');
    setDate('Até', '2026-11-08');
    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.statement)).toHaveLength(1);
    });
    const [{ url, init }] = callsTo(fetchMock, PLANTAE.statement) as [
      { url: URL; init: RequestInit },
    ];
    expect(Object.fromEntries(url.searchParams)).toEqual({
      conta_id: '1496',
      data_inicio: '2026-11-01',
      data_fim: '2026-11-08',
      per_page: '50',
      paginas: '1',
    });
    expect(init.cache).toBe('no-store');
  });

  it('mostra os saldos e o saldo por linha EXATAMENTE como a API, sem somar e sem moeda', async () => {
    // As linhas propositalmente NAO somam ate o saldo final: a tela nao pode recalcular.
    mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: { status: 200, body: CONTAS },
        [PLANTAE.statement]: {
          status: 200,
          body: statement(
            [
              makeMovement({ descricao: 'Linha um', valor: '10', saldo: '9000.80' }),
              makeMovement({
                mov_conta_id: 2,
                descricao: 'Linha dois',
                natureza: { codigo: 'C', descricao: 'Credito' },
                valor: '0.5',
                saldo: '-12.3',
              }),
            ],
            { saldo_anterior: '2605.14', saldo_final: '3470.10' },
          ),
        },
      }),
    );
    await openTab(ABA);
    await carregarContas();
    await userEvent.selectOptions(screen.getByLabelText('Conta'), '1496');
    await consultar();

    expect(await screen.findByText('2.605,14')).toBeInTheDocument();
    expect(screen.getByText('3.470,10')).toBeInTheDocument();
    const um = (await screen.findByText('Linha um')).closest('tr') as HTMLElement;
    expect(within(um).getByText('Saída')).toBeInTheDocument();
    expect(within(um).getByText('10,00')).toBeInTheDocument();
    expect(within(um).getByText('9.000,80')).toBeInTheDocument();
    const dois = screen.getByText('Linha dois').closest('tr') as HTMLElement;
    expect(within(dois).getByText('Entrada')).toBeInTheDocument();
    expect(within(dois).getByText('-12,30')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Conta Ficticia · Conta bancária · ****7654',
    );
    expect(document.body).not.toHaveTextContent('R$');
  });

  it('"Carregar mais" usa a conta e o periodo originais e mantem os saldos do periodo', async () => {
    const respostas = [
      statement(
        [makeMovement({ descricao: 'Primeira' })],
        { saldo_anterior: '100', saldo_final: '200' },
        {
          nextCursor: 'ext-2',
          hasMore: true,
        },
      ),
      statement([makeMovement({ mov_conta_id: 2, descricao: 'Segunda' })], {
        saldo_anterior: '999',
        saldo_final: '999',
      }),
    ];
    const fetchMock = mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: { status: 200, body: CONTAS },
        [PLANTAE.statement]: () => ({ status: 200, body: respostas.shift() }),
      }),
    );
    await openTab(ABA);
    await carregarContas();
    await userEvent.selectOptions(screen.getByLabelText('Conta'), '1496');
    await consultar();
    await screen.findByText('Primeira');

    // Troca a conta nos campos SEM consultar: o "Carregar mais" ignora.
    await userEvent.selectOptions(screen.getByLabelText('Conta'), '1500');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Segunda')).toBeInTheDocument();
    expect(screen.getByText('Primeira')).toBeInTheDocument();
    const [primeira, segunda] = callsTo(fetchMock, PLANTAE.statement);
    expect(Object.fromEntries(segunda?.url.searchParams ?? [])).toEqual({
      ...Object.fromEntries(primeira?.url.searchParams ?? []),
      cursor: 'ext-2',
    });
    expect(segunda?.url.searchParams.get('conta_id')).toBe('1496');
    expect(screen.getByText('100,00')).toBeInTheDocument();
    expect(screen.getByText('200,00')).toBeInTheDocument();
    expect(screen.queryByText('999,00')).not.toBeInTheDocument();
  });

  it('"Carregar mais contas" usa o cursor de financial/accounts', async () => {
    const respostas = [
      list([makeAccount()], { nextCursor: 'acc-2', hasMore: true }),
      list([makeAccount({ conta_id: 1600, nome: 'Outra Conta', numero_conta: '****1111' })]),
    ];
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.accounts]: () => ({ status: 200, body: respostas.shift() }) }),
    );
    await openTab(ABA);
    await carregarContas();

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais contas' }));

    expect(
      await screen.findByRole('option', { name: 'Outra Conta · Conta bancária · ****1111' }),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, PLANTAE.accounts)[1]?.url.searchParams.get('cursor')).toBe('acc-2');
  });

  it('periodo padrao e o mes corrente', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: { status: 200, body: CONTAS },
        [PLANTAE.statement]: {
          status: 200,
          body: statement([], { saldo_anterior: '0', saldo_final: '0' }),
        },
      }),
    );
    await openTab(ABA);
    await carregarContas();
    await userEvent.selectOptions(screen.getByLabelText('Conta'), '1496');
    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.statement)).toHaveLength(1);
    });
    const { de, ate } = currentMonthPeriod();
    const params = callsTo(fetchMock, PLANTAE.statement)[0]?.url.searchParams;
    expect(params?.get('data_inicio')).toBe(de);
    expect(params?.get('data_fim')).toBe(ate);
    expect(await screen.findByText('Nenhum movimento nesta conta no período.')).toBeInTheDocument();
  });

  it('erros ao carregar contas e ao consultar o extrato: mensagens amigaveis', async () => {
    const respostas = [
      { status: 424, body: { message: 'PLANTAE_TIMEOUT: O Plantae nao respondeu a tempo' } },
      { status: 200, body: CONTAS },
    ];
    mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: () => respostas.shift() ?? { status: 500 },
        [PLANTAE.statement]: {
          status: 424,
          body: { message: 'PLANTAE_FORBIDDEN: A credencial nao tem permissao' },
        },
      }),
    );
    await openTab(ABA);

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar contas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O Plantae demorou para responder');

    // Sem contas carregadas (a primeira tentativa falhou), o botao continua "Carregar contas".
    await userEvent.click(screen.getByRole('button', { name: 'Carregar contas' }));
    await screen.findByRole('option', { name: 'Conta Ficticia · Conta bancária · ****7654' });
    await userEvent.selectOptions(screen.getByLabelText('Conta'), '1496');
    await consultar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A integração não tem permissão para esta consulta no Plantae.',
    );
    expect(screen.queryByText(/PLANTAE_/)).not.toBeInTheDocument();
  });

  it('nada vai para localStorage ou sessionStorage', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.accounts]: { status: 200, body: CONTAS },
        [PLANTAE.statement]: {
          status: 200,
          body: statement([makeMovement({ descricao: 'Linha um', saldo: '9000.80' })], {
            saldo_anterior: '2605.14',
            saldo_final: '3470.10',
          }),
        },
      }),
    );
    await openTab(ABA);
    await carregarContas();
    await userEvent.selectOptions(screen.getByLabelText('Conta'), '1496');
    await consultar();
    await screen.findByText('Linha um');

    expectNothingStored(['Linha um', '2605.14', '3470.10', 'Conta Ficticia', '****7654']);
  });
});
