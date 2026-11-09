import {
  ApiError,
  NetworkError,
  plantaeAccountsParams,
  plantaeEntriesParams,
  plantaeMovementsParams,
  plantaePeopleParams,
  plantaeStatementParams,
} from '../../api/client';
import { describePlantaeError } from './plantae-errors';
import {
  accountTypeLabel,
  conciliationLabel,
  currentMonthPeriod,
  entryStatusView,
  formatPlantaeDate,
  formatPlantaeDecimal,
  installmentLabel,
  maskedAccountNumber,
  maskedDocument,
  NBSP,
  periodProblem,
  personName,
  personTypeLabel,
  searchProblem,
} from './plantae-format';

describe('rotulos das demais abas', () => {
  it('numero de conta so mascarado; sem mascara vira traco', () => {
    expect(maskedAccountNumber('****7654')).toBe('****7654');
    expect(maskedAccountNumber('****')).toBe('****');
    expect(maskedAccountNumber('98765-4')).toBe('—');
    expect(maskedAccountNumber(null)).toBe('—');
  });

  it('tipo de conta: 1 a 4; desconhecido usa a descricao; nulo vira traco', () => {
    expect(accountTypeLabel({ codigo: 1, descricao: 'x' })).toBe('Caixa');
    expect(accountTypeLabel({ codigo: 2, descricao: 'x' })).toBe('Conta bancária');
    expect(accountTypeLabel({ codigo: 3, descricao: 'x' })).toBe('Aplicação');
    expect(accountTypeLabel({ codigo: 4, descricao: 'x' })).toBe('Numerário em trânsito');
    expect(accountTypeLabel({ codigo: 7, descricao: 'Outro' })).toBe('Outro');
    expect(accountTypeLabel({ codigo: 7, descricao: null })).toBe('Código 7');
    expect(accountTypeLabel(null)).toBe('—');
  });

  it('tipo de pessoa F/J, preservando outro valor', () => {
    expect(personTypeLabel('F')).toBe('Física (F)');
    expect(personTypeLabel('J')).toBe('Jurídica (J)');
    expect(personTypeLabel('X')).toBe('X');
    expect(personTypeLabel(null)).toBe('—');
  });

  it('conciliacao', () => {
    expect(conciliationLabel(false, null)).toBe('Não conciliado');
    expect(conciliationLabel(false, '2026-11-05')).toBe('Não conciliado');
    expect(conciliationLabel(true, '2026-11-05')).toBe('Conciliado em 05/11/2026');
    expect(conciliationLabel(true, null)).toBe('Conciliado');
  });

  it('busca de pessoas: mesma regra do backend (2 a 100, sem controle); vazio e valido', () => {
    expect(searchProblem('')).toBeNull();
    expect(searchProblem('   ')).toBeNull();
    expect(searchProblem('ab')).toBeNull();
    expect(searchProblem(' a ')).toMatch(/2 a 100/);
    expect(searchProblem('x'.repeat(101))).toMatch(/2 a 100/);
    expect(searchProblem(`ab${String.fromCharCode(7)}c`)).toMatch(/2 a 100/);
  });
});

describe('query das demais rotas (so parametros aceitos, 50 por pagina, uma pagina)', () => {
  it('accounts', () => {
    expect(Object.fromEntries(plantaeAccountsParams({}))).toEqual({ per_page: '50', paginas: '1' });
    expect(Object.fromEntries(plantaeAccountsParams({ tipo: 2, cursor: 'c' }))).toEqual({
      per_page: '50',
      paginas: '1',
      tipo: '2',
      cursor: 'c',
    });
  });

  it('movements', () => {
    expect(
      Object.fromEntries(
        plantaeMovementsParams({ dataInicio: '2026-11-01', dataFim: '2026-11-08' }),
      ),
    ).toEqual({ per_page: '50', paginas: '1', data_inicio: '2026-11-01', data_fim: '2026-11-08' });
    const filtrado = plantaeMovementsParams({
      dataInicio: '2026-11-01',
      dataFim: '2026-11-08',
      natureza: 'C',
      conciliado: false,
    });
    expect(filtrado.get('natureza')).toBe('C');
    expect(filtrado.get('conciliado')).toBe('false');
  });

  it('account-statement', () => {
    expect(
      Object.fromEntries(
        plantaeStatementParams({ contaId: 11, dataInicio: '2026-11-01', dataFim: '2026-11-08' }),
      ),
    ).toEqual({
      per_page: '50',
      paginas: '1',
      data_inicio: '2026-11-01',
      data_fim: '2026-11-08',
      conta_id: '11',
    });
  });

  it('people: busca aparada; vazia nao vai', () => {
    expect(Object.fromEntries(plantaePeopleParams({}))).toEqual({ per_page: '50', paginas: '1' });
    expect(plantaePeopleParams({ busca: '   ' }).has('busca')).toBe(false);
    expect(plantaePeopleParams({ busca: ' agro ' }).get('busca')).toBe('agro');
  });
});

describe('formatPlantaeDecimal (texto decimal exato, sem ponto flutuante)', () => {
  it.each([
    ['8337.10', 'R$', `R$${NBSP}8.337,10`],
    ['0', 'R$', `R$${NBSP}0,00`],
    ['5', 'R$', `R$${NBSP}5,00`],
    ['1200.5', 'R$', `R$${NBSP}1.200,50`],
    ['999.99', 'R$', `R$${NBSP}999,99`],
    ['1000', 'R$', `R$${NBSP}1.000,00`],
    ['-50.5', 'R$', `-R$${NBSP}50,50`],
    ['-0.00', 'R$', `R$${NBSP}0,00`],
    ['1234.50', 'US$', `US$${NBSP}1.234,50`],
  ])('%s em %s -> %s', (valor, simbolo, esperado) => {
    expect(formatPlantaeDecimal(valor, simbolo)).toBe(esperado);
  });

  it('nao arredonda nem descarta casas', () => {
    expect(formatPlantaeDecimal('1234567.891', 'R$')).toBe(`R$${NBSP}1.234.567,891`);
    expect(formatPlantaeDecimal('0.005', 'R$')).toBe(`R$${NBSP}0,005`);
  });

  it('preserva valores alem da precisao de um number', () => {
    expect(formatPlantaeDecimal('12345678901234567890.12', 'R$')).toBe(
      `R$${NBSP}12.345.678.901.234.567.890,12`,
    );
  });

  it('sem simbolo de moeda, so o numero (nunca presume real)', () => {
    expect(formatPlantaeDecimal('8337.10', null)).toBe('8.337,10');
    expect(formatPlantaeDecimal('8337.10', undefined)).toBe('8.337,10');
    expect(formatPlantaeDecimal('8337.10', '  ')).toBe('8.337,10');
  });

  it.each([[null], [undefined], ['1e5'], ['8.337,10'], ['abc'], [''], ['01.5'], ['.5']])(
    '%p vira traco, nunca um numero inventado',
    (valor) => {
      expect(formatPlantaeDecimal(valor, 'R$')).toBe('—');
    },
  );
});

describe('rotulos e textos', () => {
  it('data AAAA-MM-DD como DD/MM/AAAA, e traco sem data', () => {
    expect(formatPlantaeDate('2026-11-10')).toBe('10/11/2026');
    expect(formatPlantaeDate(null)).toBe('—');
  });

  it('status 0, 1 e 2; codigo desconhecido usa a descricao da API', () => {
    expect(entryStatusView({ codigo: 0, descricao: 'x' }).label).toBe('Pendente');
    expect(entryStatusView({ codigo: 1, descricao: 'x' }).label).toBe('Quitada');
    expect(entryStatusView({ codigo: 2, descricao: 'x' }).label).toBe('Substituída (renegociada)');
    expect(entryStatusView({ codigo: 9, descricao: 'Outro' }).label).toBe('Outro');
    expect(entryStatusView({ codigo: 9, descricao: null }).label).toBe('Código 9');
  });

  it('parcela', () => {
    expect(installmentLabel(1, 3)).toBe('1/3');
    expect(installmentLabel(2, null)).toBe('2');
    expect(installmentLabel(null, 3)).toBe('—');
  });

  it('pessoa: nome, depois razao social, depois traco', () => {
    const base = { pessoa_id: 1, tipo_pessoa: 'J', cpf_cnpj: null };
    expect(personName({ ...base, nome: 'Nome', razao_social: 'Razao' })).toBe('Nome');
    expect(personName({ ...base, nome: ' ', razao_social: 'Razao' })).toBe('Razao');
    expect(personName({ ...base, nome: null, razao_social: null })).toBe('—');
    expect(personName(null)).toBe('—');
  });

  it('documento so aparece se ja veio mascarado', () => {
    const base = { pessoa_id: 1, nome: 'X', razao_social: null, tipo_pessoa: 'F' };
    expect(maskedDocument({ ...base, cpf_cnpj: '***.456.789-**' })).toBe('***.456.789-**');
    expect(maskedDocument({ ...base, cpf_cnpj: '12.345.678/****-**' })).toBe('12.345.678/****-**');
    expect(maskedDocument({ ...base, cpf_cnpj: '123.456.789-09' })).toBeNull();
    expect(maskedDocument({ ...base, cpf_cnpj: null })).toBeNull();
    expect(maskedDocument(null)).toBeNull();
  });
});

describe('periodo', () => {
  it('mes corrente no calendario local', () => {
    expect(currentMonthPeriod(new Date(2026, 10, 8))).toEqual({
      de: '2026-11-01',
      ate: '2026-11-30',
    });
    expect(currentMonthPeriod(new Date(2028, 1, 15))).toEqual({
      de: '2028-02-01',
      ate: '2028-02-29',
    });
    expect(currentMonthPeriod(new Date(2026, 11, 31))).toEqual({
      de: '2026-12-01',
      ate: '2026-12-31',
    });
  });

  it('mesma regra do backend: extremos incluidos, ate 366 dias', () => {
    expect(periodProblem('2026-11-01', '2026-11-08')).toBeNull();
    expect(periodProblem('2026-11-08', '2026-11-08')).toBeNull();
    expect(periodProblem('2026-01-01', '2027-01-01')).toBeNull(); // 366 dias
    expect(periodProblem('2026-01-01', '2027-01-02')).toMatch(/366 dias/);
    expect(periodProblem('2026-11-08', '2026-11-01')).toMatch(/posterior/);
    expect(periodProblem('', '2026-11-01')).toMatch(/Informe o período/);
    expect(periodProblem('2026-02-31', '2026-03-01')).toMatch(/datas válidas/);
  });
});

describe('query de financial/entries', () => {
  it('so os parametros aceitos pelo backend, com 50 por pagina e uma pagina', () => {
    const params = plantaeEntriesParams({
      dataInicio: '2026-11-01',
      dataFim: '2026-11-08',
      tipo: 'despesa',
    });

    expect(Object.fromEntries(params)).toEqual({
      data_inicio: '2026-11-01',
      data_fim: '2026-11-08',
      tipo: 'despesa',
      per_page: '50',
      paginas: '1',
    });
  });

  it('status e cursor so quando informados; o cursor vai como veio', () => {
    const params = plantaeEntriesParams({
      dataInicio: '2026-10-01',
      dataFim: '2026-11-08',
      tipo: 'receita',
      status: 1,
      cursor: 'eyJ+opaco/=',
    });

    expect(params.get('status')).toBe('1');
    expect(params.get('cursor')).toBe('eyJ+opaco/=');
    expect(params.getAll('status')).toHaveLength(1);
  });
});

describe('describePlantaeError (nunca o texto bruto)', () => {
  const erro = (status: number, mensagem: string): ApiError => new ApiError(status, mensagem);

  it.each([
    ['PLANTAE_UNREACHABLE: Nao foi possivel conectar ao Plantae', /indisponível/],
    ['PLANTAE_TIMEOUT: O Plantae nao respondeu a tempo', /demorou/],
    ['PLANTAE_DISABLED: A integracao...', /não está disponível/],
    ['PLANTAE_AUTH_REJECTED: ...', /administrador/],
    ['PLANTAE_REJECTED_PARAMETERS: rejeitou (parametros: busca)', /recusou os filtros/],
    ['PLANTAE_INVALID_RESPONSE: ...', /nenhum dado foi exibido/],
    ['ALGO_NOVO: CPF 123.456.789-09', /Não foi possível consultar o Plantae/],
  ])('424 %s', (mensagem, esperado) => {
    const texto = describePlantaeError(erro(424, mensagem));
    expect(texto).toMatch(esperado);
    expect(texto).not.toContain(mensagem);
    expect(texto).not.toContain('123.456.789-09');
  });

  it('429 com e sem segundos de espera', () => {
    expect(
      describePlantaeError(
        erro(
          429,
          'PLANTAE_RATE_LIMITED: Limite de consultas ao Plantae atingido. Tente novamente em 30 s',
        ),
      ),
    ).toBe('Limite de consultas ao Plantae atingido. Tente novamente em 30 s.');
    expect(describePlantaeError(erro(429, 'x'))).toMatch(/Aguarde/);
  });

  it('400, 401 e 403 tem mensagens proprias, sem repetir o backend', () => {
    expect(describePlantaeError(erro(400, 'parametro desconhecido: pessoa_id'))).toMatch(
      /Filtros inválidos/,
    );
    expect(describePlantaeError(erro(400, 'parametro desconhecido: pessoa_id'))).not.toMatch(
      /pessoa_id/,
    );
    expect(describePlantaeError(erro(401, 'Token invalido'))).toMatch(/sessão expirou/);
    expect(describePlantaeError(erro(403, 'Voce nao tem permissao'))).toMatch(/não tem permissão/);
  });

  it('falha de rede e erro desconhecido', () => {
    expect(describePlantaeError(new NetworkError())).toMatch(/conectar ao servidor/);
    expect(describePlantaeError(new Error('boom'))).toMatch(/Não foi possível consultar/);
  });
});
