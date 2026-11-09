import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlantaeEntry } from '../../api/client';
import { currentMonthPeriod } from './plantae-format';
import {
  ADMIN,
  callsTo,
  consultar,
  GESTOR_SEM_PLANTAE,
  list,
  mockApi,
  PLANTAE,
  type Reply,
  renderAt,
  RIZOLA,
  session,
  setDate,
} from './plantae-test-support';

const ENTRIES = PLANTAE.entries;

// O Testing Library normaliza o texto do DOM (o espaco nao separavel entre simbolo
// e numero vira espaco comum) mas nao a string esperada: aqui vai espaco comum. O
// caractere exato e conferido nos testes de `plantae-format`.

function makeEntry(overrides: Partial<PlantaeEntry> = {}): PlantaeEntry {
  return {
    parcela_id: 482,
    numero: 1,
    total_parcelas: 3,
    data_vencto: '2026-11-10',
    valor: '8337.10',
    total_pago: '0.00',
    total_juros: null,
    total_multa: null,
    total_desconto: null,
    total_abatido: null,
    saldo_atual: '1200.5',
    data_ult_pagto: null,
    status: { codigo: 0, descricao: 'Pendente' },
    titulo: {
      titulo_id: 1293,
      tipo: { codigo: 1, descricao: 'Duplicata' },
      origem: { codigo: 3, descricao: 'Compra' },
      num_documento: 'DOC-001',
      data_emissao: '2026-10-01',
      valor_total: '25011.30',
      moeda: { moeda_id: 1, nome: 'Real', simbolo: 'R$' },
      descricao: 'Titulo ficticio',
      observacao: null,
    },
    pessoa: {
      pessoa_id: 6990,
      nome: 'Fornecedor Ficticio',
      razao_social: null,
      tipo_pessoa: 'J',
      cpf_cnpj: '12.345.678/****-**',
    },
    ...overrides,
  };
}

describe('acesso ao painel Plantae', () => {
  it('GESTOR com plantae:read ve a pagina, o aviso fixo e a aba, sem consultar nada ao abrir', async () => {
    const fetchMock = mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([]) } }));

    renderAt('/plantae');

    expect(await screen.findByRole('heading', { name: 'Plantae' })).toBeInTheDocument();
    expect(
      screen.getByText('Dados consultados no Plantae em tempo real. Somente leitura.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Contas a pagar e receber' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('button', { name: 'Consultar' })).toBeInTheDocument();
    expect(callsTo(fetchMock, ENTRIES)).toHaveLength(0);
  });

  it('sem plantae:read: acesso negado e nenhuma chamada ao Plantae', async () => {
    const fetchMock = mockApi(session(GESTOR_SEM_PLANTAE));

    renderAt('/plantae');

    expect(await screen.findByRole('heading', { name: 'Acesso negado' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Consultar' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, ENTRIES)).toHaveLength(0);
  });

  it('o link Plantae nao aparece no menu sem plantae:read', async () => {
    mockApi(session(GESTOR_SEM_PLANTAE));
    renderAt('/dashboard');

    await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(screen.queryByRole('link', { name: 'Plantae' })).not.toBeInTheDocument();
  });

  it.each([
    ['GESTOR com plantae:read', RIZOLA],
    ['ADMIN', ADMIN],
  ])('o link Plantae aparece para %s', async (_nome, me) => {
    mockApi(session(me));
    renderAt('/dashboard');

    expect(await screen.findByRole('link', { name: 'Plantae' })).toHaveAttribute(
      'href',
      '/plantae',
    );
  });
});

describe('consulta', () => {
  it('so consulta ao clicar; mudar filtros nao dispara nada', async () => {
    const fetchMock = mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([]) } }));
    renderAt('/plantae');

    await userEvent.selectOptions(await screen.findByLabelText('Tipo'), 'receita');
    await userEvent.selectOptions(screen.getByLabelText('Situação'), '1');
    setDate('Vencimento de', '2026-10-01');
    expect(callsTo(fetchMock, ENTRIES)).toHaveLength(0);

    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, ENTRIES)).toHaveLength(1);
    });
  });

  it('padrao: contas a pagar do mes corrente, 50 por pagina, uma pagina, sem status e sem cache', async () => {
    const fetchMock = mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([]) } }));
    renderAt('/plantae');

    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, ENTRIES)).toHaveLength(1);
    });
    const [{ url, init }] = callsTo(fetchMock, ENTRIES) as [{ url: URL; init: RequestInit }];
    const { de, ate } = currentMonthPeriod();
    expect(Object.fromEntries(url.searchParams)).toEqual({
      data_inicio: de,
      data_fim: ate,
      tipo: 'despesa',
      per_page: '50',
      paginas: '1',
    });
    expect(init.cache).toBe('no-store');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-guardado' });
  });

  it('envia tipo, situacao e periodo escolhidos', async () => {
    const fetchMock = mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([]) } }));
    renderAt('/plantae');

    await userEvent.selectOptions(await screen.findByLabelText('Tipo'), 'despesa');
    await userEvent.selectOptions(screen.getByLabelText('Situação'), '1');
    setDate('Vencimento de', '2026-10-01');
    setDate('Vencimento até', '2026-11-08');
    await consultar();

    await waitFor(() => {
      expect(callsTo(fetchMock, ENTRIES)).toHaveLength(1);
    });
    const params = callsTo(fetchMock, ENTRIES)[0]?.url.searchParams;
    expect(params?.get('tipo')).toBe('despesa');
    expect(params?.getAll('status')).toEqual(['1']);
    expect(params?.get('data_inicio')).toBe('2026-10-01');
    expect(params?.get('data_fim')).toBe('2026-11-08');
  });

  it('clique duplo em Consultar faz uma unica chamada', async () => {
    let liberar: (reply: Reply) => void = () => undefined;
    const fetchMock = mockApi(
      session(RIZOLA, {
        [ENTRIES]: () =>
          new Promise<Reply>((resolve) => {
            liberar = resolve;
          }),
      }),
    );
    renderAt('/plantae');

    await userEvent.dblClick(await screen.findByRole('button', { name: 'Consultar' }));

    expect(await screen.findByRole('button', { name: 'Consultando…' })).toBeDisabled();
    expect(callsTo(fetchMock, ENTRIES)).toHaveLength(1);
    liberar({ status: 200, body: list([]) });
    expect(
      await screen.findByText('Nenhuma parcela encontrada para os filtros aplicados.'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, ENTRIES)).toHaveLength(1);
  });

  it.each([
    ['2026-11-08', '2026-11-01', 'A data inicial não pode ser posterior à final.'],
    ['2026-01-01', '2027-01-02', 'O período pode ter no máximo 366 dias.'],
    ['', '2026-11-01', 'Informe o período (data inicial e final).'],
  ])('periodo invalido (%s a %s) nao consulta: %s', async (de, ate, mensagem) => {
    const fetchMock = mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([]) } }));
    renderAt('/plantae');
    await screen.findByRole('button', { name: 'Consultar' });

    setDate('Vencimento de', de);
    setDate('Vencimento até', ate);
    await consultar();

    expect(await screen.findByText(mensagem)).toBeInTheDocument();
    expect(callsTo(fetchMock, ENTRIES)).toHaveLength(0);
  });
});

describe('apresentacao das parcelas', () => {
  const linha = async (texto: string): Promise<HTMLElement> =>
    (await screen.findByText(texto)).closest('tr') as HTMLElement;

  it('mostra vencimento, tipo, pessoa, documento mascarado, descricao, parcela, valor, saldo e situacao', async () => {
    mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([makeEntry()]) } }));
    renderAt('/plantae');
    await consultar();

    const row = await linha('Fornecedor Ficticio');
    expect(within(row).getByText('10/11/2026')).toBeInTheDocument();
    expect(within(row).getByText('Despesa')).toBeInTheDocument();
    expect(within(row).getByText('12.345.678/****-**')).toBeInTheDocument();
    expect(within(row).getByText('Titulo ficticio')).toBeInTheDocument();
    expect(within(row).getByText('Doc. DOC-001')).toBeInTheDocument();
    expect(within(row).getByText('1/3')).toBeInTheDocument();
    expect(within(row).getByText('R$ 8.337,10')).toBeInTheDocument();
    expect(within(row).getByText('R$ 1.200,50')).toBeInTheDocument();
    expect(within(row).getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fornecedor/Favorecido' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Contas a pagar');
    expect(screen.getByRole('status')).toHaveTextContent('1 parcela');
  });

  it('em contas a receber a pessoa e o Cliente e o tipo e Receita', async () => {
    mockApi(
      session(RIZOLA, {
        [ENTRIES]: {
          status: 200,
          body: list([makeEntry({ pessoa: { ...makeEntry().pessoa!, nome: 'Cliente Ficticio' } })]),
        },
      }),
    );
    renderAt('/plantae');

    await userEvent.selectOptions(await screen.findByLabelText('Tipo'), 'receita');
    await consultar();

    const row = await linha('Cliente Ficticio');
    expect(within(row).getByText('Receita')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Cliente' })).toBeInTheDocument();
  });

  it('quitada e substituida (renegociada, nunca "cancelada")', async () => {
    mockApi(
      session(RIZOLA, {
        [ENTRIES]: {
          status: 200,
          body: list([
            makeEntry({ parcela_id: 1, status: { codigo: 1, descricao: 'Quitada' } }),
            makeEntry({ parcela_id: 2, status: { codigo: 2, descricao: 'Substituida' } }),
          ]),
        },
      }),
    );
    renderAt('/plantae');
    await consultar();

    expect(await screen.findByText('Quitada')).toBeInTheDocument();
    expect(screen.getByText('Substituída (renegociada)')).toBeInTheDocument();
    expect(screen.queryByText(/cancelad/i)).not.toBeInTheDocument();
  });

  it('preserva a moeda do titulo e nao presume real quando ela nao vem', async () => {
    const titulo = makeEntry().titulo;
    mockApi(
      session(RIZOLA, {
        [ENTRIES]: {
          status: 200,
          body: list([
            makeEntry({
              parcela_id: 1,
              valor: '1234.5',
              saldo_atual: '0',
              titulo: {
                ...titulo,
                descricao: 'Em dolar',
                moeda: { moeda_id: 2, nome: 'Dolar', simbolo: 'US$' },
              },
            }),
            makeEntry({
              parcela_id: 2,
              valor: '99.999',
              saldo_atual: null,
              titulo: { ...titulo, descricao: 'Sem moeda', moeda: null },
            }),
          ]),
        },
      }),
    );
    renderAt('/plantae');
    await consultar();

    const dolar = await linha('Em dolar');
    expect(within(dolar).getByText('US$ 1.234,50')).toBeInTheDocument();
    expect(within(dolar).getByText('US$ 0,00')).toBeInTheDocument();
    const semMoeda = await linha('Sem moeda');
    expect(within(semMoeda).getByText('99,999')).toBeInTheDocument();
    expect(within(semMoeda).queryByText(/R\$/)).not.toBeInTheDocument();
  });

  it('documento que chegasse SEM mascara nao e exibido (defesa em profundidade)', async () => {
    const pessoa = { ...makeEntry().pessoa!, cpf_cnpj: '123.456.789-09' };
    mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([makeEntry({ pessoa })]) } }));
    renderAt('/plantae');
    await consultar();

    await linha('Fornecedor Ficticio');
    expect(screen.queryByText('123.456.789-09')).not.toBeInTheDocument();
  });

  it('lista vazia', async () => {
    mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([]) } }));
    renderAt('/plantae');
    await consultar();

    expect(
      await screen.findByText('Nenhuma parcela encontrada para os filtros aplicados.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('paginacao por cursor', () => {
  it('"Carregar mais" usa o cursor com os filtros ORIGINAIS e acrescenta as parcelas', async () => {
    const respostas = [
      list(
        [makeEntry({ parcela_id: 1, titulo: { ...makeEntry().titulo, descricao: 'Primeira' } })],
        {
          nextCursor: 'cur-2',
          hasMore: true,
        },
      ),
      list(
        [makeEntry({ parcela_id: 2, titulo: { ...makeEntry().titulo, descricao: 'Segunda' } })],
        {
          nextCursor: null,
          hasMore: false,
        },
      ),
    ];
    const fetchMock = mockApi(
      session(RIZOLA, { [ENTRIES]: () => ({ status: 200, body: respostas.shift() }) }),
    );
    renderAt('/plantae');
    await consultar();
    expect(await screen.findByText('Primeira')).toBeInTheDocument();

    // Muda os campos SEM consultar: o "Carregar mais" nao pode usar estes valores.
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'receita');
    setDate('Vencimento de', '2025-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Segunda')).toBeInTheDocument();
    expect(screen.getByText('Primeira')).toBeInTheDocument();
    const [primeira, segunda] = callsTo(fetchMock, ENTRIES);
    expect(primeira?.url.searchParams.has('cursor')).toBe(false);
    const esperado = Object.fromEntries(primeira?.url.searchParams ?? []);
    expect(Object.fromEntries(segunda?.url.searchParams ?? [])).toEqual({
      ...esperado,
      cursor: 'cur-2',
    });
    expect(segunda?.url.searchParams.get('tipo')).toBe('despesa');
    expect(screen.getByRole('status')).toHaveTextContent('2 parcelas');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('sem cursor e sem informacao de "ha mais": avisa, sem botao', async () => {
    mockApi(
      session(RIZOLA, {
        [ENTRIES]: { status: 200, body: list([makeEntry()], { nextCursor: null, hasMore: null }) },
      }),
    );
    renderAt('/plantae');
    await consultar();

    expect(
      await screen.findByText('O Plantae não informou se há mais parcelas para estes filtros.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });
});

describe('erros (sem texto bruto do backend)', () => {
  it.each([
    [
      424,
      'PLANTAE_UNREACHABLE: Nao foi possivel conectar ao Plantae',
      'O Plantae está indisponível no momento. Tente novamente em instantes.',
    ],
    [
      424,
      'PLANTAE_REJECTED_PARAMETERS: O Plantae rejeitou os parametros da consulta (parametros: data_fim)',
      'O Plantae recusou os filtros informados. Revise e tente novamente.',
    ],
    [
      429,
      'PLANTAE_RATE_LIMITED: Limite de consultas ao Plantae atingido. Tente novamente em 30 s',
      'Limite de consultas ao Plantae atingido. Tente novamente em 30 s.',
    ],
    [403, 'Voce nao tem permissao para esta acao', 'Você não tem permissão para esta consulta.'],
  ])('%i %s', async (status, mensagem, amigavel) => {
    mockApi(session(RIZOLA, { [ENTRIES]: { status, body: { message: mensagem } } }));
    renderAt('/plantae');
    await consultar();

    expect(await screen.findByRole('alert')).toHaveTextContent(amigavel);
    expect(screen.queryByText(mensagem, { exact: false })).not.toBeInTheDocument();
  });

  it('400 com detalhes de validacao: mensagem propria, sem os detalhes', async () => {
    mockApi(
      session(RIZOLA, {
        [ENTRIES]: { status: 400, body: { message: ['parametro desconhecido: pessoa_id'] } },
      }),
    );
    renderAt('/plantae');
    await consultar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Filtros inválidos');
    expect(screen.queryByText(/pessoa_id/)).not.toBeInTheDocument();
  });

  it('depois de um erro, uma nova consulta funciona', async () => {
    const respostas: Reply[] = [
      { status: 424, body: { message: 'PLANTAE_TIMEOUT: O Plantae nao respondeu a tempo' } },
      { status: 200, body: list([makeEntry()]) },
    ];
    mockApi(session(RIZOLA, { [ENTRIES]: () => respostas.shift() ?? { status: 500 } }));
    renderAt('/plantae');

    await consultar();
    expect(await screen.findByRole('alert')).toHaveTextContent('demorou para responder');
    await consultar();

    expect(await screen.findByText('Fornecedor Ficticio')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('sem persistencia nem cache', () => {
  it('nada da consulta vai para localStorage ou sessionStorage', async () => {
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    mockApi(session(RIZOLA, { [ENTRIES]: { status: 200, body: list([makeEntry()]) } }));
    renderAt('/plantae');
    localSet.mockClear(); // ignora a sessao gravada pelo `renderAt`

    await consultar();
    await screen.findByText('Fornecedor Ficticio');

    const gravados = localSet.mock.calls.map(([chave]) => chave);
    expect(gravados.every((chave) => chave === 'vastaflow.session')).toBe(true);
    expect(sessionStorage.length).toBe(0);
    expect(Object.keys(localStorage)).toEqual(['vastaflow.session']);
    const tudo = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    for (const dado of ['Fornecedor Ficticio', '8337.10', '12.345.678', 'DOC-001']) {
      expect(tudo).not.toContain(dado);
    }
    localSet.mockRestore();
  });

  it('sair e voltar a tela descarta o resultado e nao consulta sozinho', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, { [ENTRIES]: { status: 200, body: list([makeEntry()]) } }),
    );
    renderAt('/plantae');
    await consultar();
    await screen.findByText('Fornecedor Ficticio');

    await userEvent.click(screen.getByRole('link', { name: 'Início' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Plantae' }));

    expect(await screen.findByRole('button', { name: 'Consultar' })).toBeInTheDocument();
    expect(screen.queryByText('Fornecedor Ficticio')).not.toBeInTheDocument();
    expect(callsTo(fetchMock, ENTRIES)).toHaveLength(1);
  });
});
