import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  callsTo,
  consultar,
  expectNothingStored,
  list,
  makePerson,
  mockApi,
  openTab,
  PLANTAE,
  RIZOLA,
  session,
} from './plantae-test-support';

const ABA = 'Pessoas';
const AVISO = 'O Plantae não informa diretamente se cada cadastro é cliente ou fornecedor.';

const linha = async (texto: string): Promise<HTMLElement> =>
  (await screen.findByText(texto)).closest('tr') as HTMLElement;

describe('aba Pessoas', () => {
  it('mostra o aviso fixo e nao consulta ao abrir', async () => {
    const fetchMock = mockApi(session(RIZOLA));
    await openTab(ABA);

    expect(await screen.findByText(AVISO)).toBeInTheDocument();
    expect(callsTo(fetchMock, PLANTAE.people)).toHaveLength(0);
  });

  it('sem busca: so paginacao, sem o parametro busca, sem cache', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.people]: { status: 200, body: list([]) } }),
    );
    await openTab(ABA);

    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.people)).toHaveLength(1);
    });
    const [{ url, init }] = callsTo(fetchMock, PLANTAE.people) as [{ url: URL; init: RequestInit }];
    expect(Object.fromEntries(url.searchParams)).toEqual({ per_page: '50', paginas: '1' });
    expect(init.cache).toBe('no-store');
  });

  it('busca aparada e enviada; espacos sozinhos = sem busca', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.people]: { status: 200, body: list([]) } }),
    );
    await openTab(ABA);

    await userEvent.type(await screen.findByLabelText('Buscar (opcional)'), '  agro  ');
    await consultar();
    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.people)).toHaveLength(1);
    });
    expect(callsTo(fetchMock, PLANTAE.people)[0]?.url.searchParams.get('busca')).toBe('agro');

    await userEvent.clear(screen.getByLabelText('Buscar (opcional)'));
    await userEvent.type(screen.getByLabelText('Buscar (opcional)'), '   ');
    await consultar();
    await waitFor(() => {
      expect(callsTo(fetchMock, PLANTAE.people)).toHaveLength(2);
    });
    expect(callsTo(fetchMock, PLANTAE.people)[1]?.url.searchParams.has('busca')).toBe(false);
  });

  it('busca de 1 caractere nao consulta', async () => {
    const fetchMock = mockApi(session(RIZOLA));
    await openTab(ABA);

    await userEvent.type(await screen.findByLabelText('Buscar (opcional)'), 'a');
    await consultar();

    expect(await screen.findByText('A busca deve ter de 2 a 100 caracteres.')).toBeInTheDocument();
    expect(callsTo(fetchMock, PLANTAE.people)).toHaveLength(0);
  });

  it('mostra nome, razao social, tipo F/J e CPF/CNPJ mascarado', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.people]: {
          status: 200,
          body: list([
            makePerson(),
            makePerson({
              pessoa_id: 7000,
              nome: 'Empresa Ficticia',
              razao_social: 'Empresa Ficticia LTDA',
              tipo_pessoa: 'J',
              cpf_cnpj: '12.345.678/****-**',
            }),
          ]),
        },
      }),
    );
    await openTab(ABA);
    await consultar();

    const fisica = await linha('Pessoa Ficticia');
    expect(within(fisica).getByText('Física (F)')).toBeInTheDocument();
    expect(within(fisica).getByText('***.456.789-**')).toBeInTheDocument();
    expect(within(fisica).getByText('—')).toBeInTheDocument();

    const juridica = await linha('Empresa Ficticia');
    expect(within(juridica).getByText('Empresa Ficticia LTDA')).toBeInTheDocument();
    expect(within(juridica).getByText('Jurídica (J)')).toBeInTheDocument();
    expect(within(juridica).getByText('12.345.678/****-**')).toBeInTheDocument();
  });

  it('nao classifica ninguem como cliente ou fornecedor', async () => {
    mockApi(session(RIZOLA, { [PLANTAE.people]: { status: 200, body: list([makePerson()]) } }));
    await openTab(ABA);
    await consultar();
    await linha('Pessoa Ficticia');

    expect(screen.getByRole('table')).not.toHaveTextContent(/cliente|fornecedor/i);
    expect(
      screen.queryByRole('columnheader', { name: /cliente|fornecedor/i }),
    ).not.toBeInTheDocument();
  });

  it('documento que chegasse sem mascara nao aparece', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.people]: {
          status: 200,
          body: list([makePerson({ cpf_cnpj: '123.456.789-09' })]),
        },
      }),
    );
    await openTab(ABA);
    await consultar();

    const row = await linha('Pessoa Ficticia');
    expect(within(row).queryByText('123.456.789-09')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).not.toHaveTextContent('123.456.789-09');
  });

  it('"Carregar mais" mantem a busca original', async () => {
    const respostas = [
      list([makePerson({ nome: 'Primeira' })], { nextCursor: 'pes-2', hasMore: true }),
      list([makePerson({ pessoa_id: 2, nome: 'Segunda' })], { nextCursor: null, hasMore: null }),
    ];
    const fetchMock = mockApi(
      session(RIZOLA, { [PLANTAE.people]: () => ({ status: 200, body: respostas.shift() }) }),
    );
    await openTab(ABA);
    await userEvent.type(await screen.findByLabelText('Buscar (opcional)'), 'agro');
    await consultar();
    await screen.findByText('Primeira');

    await userEvent.clear(screen.getByLabelText('Buscar (opcional)'));
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Segunda')).toBeInTheDocument();
    expect(
      Object.fromEntries(callsTo(fetchMock, PLANTAE.people)[1]?.url.searchParams ?? []),
    ).toEqual({
      per_page: '50',
      paginas: '1',
      busca: 'agro',
      cursor: 'pes-2',
    });
    expect(
      screen.getByText('O Plantae não informou se há mais cadastros para estes filtros.'),
    ).toBeInTheDocument();
  });

  it('400 do backend: mensagem propria, sem repetir o termo', async () => {
    mockApi(
      session(RIZOLA, {
        [PLANTAE.people]: {
          status: 400,
          body: { message: ['busca deve ter de 2 a 100 caracteres, sem controle'] },
        },
      }),
    );
    await openTab(ABA);
    await userEvent.type(await screen.findByLabelText('Buscar (opcional)'), 'termo-x');
    await consultar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Filtros inválidos');
    expect(screen.queryByText(/sem controle/)).not.toBeInTheDocument();
  });

  it('nem o termo de busca nem os cadastros vao para o armazenamento do navegador', async () => {
    mockApi(session(RIZOLA, { [PLANTAE.people]: { status: 200, body: list([makePerson()]) } }));
    await openTab(ABA);
    await userEvent.type(await screen.findByLabelText('Buscar (opcional)'), 'termo-secreto');
    await consultar();
    await linha('Pessoa Ficticia');

    expectNothingStored(['termo-secreto', 'Pessoa Ficticia', '***.456.789-**']);
  });
});
