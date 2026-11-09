import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADMIN,
  callsTo,
  consultar,
  type Handler,
  list,
  makeMovement,
  mockApi,
  PLANTAE,
  plantaeCalls,
  renderAt,
  RIZOLA,
  session,
} from './plantae-test-support';

const ABAS = [
  'Contas a pagar e receber',
  'Movimentações',
  'Extratos',
  'Contas bancárias',
  'Pessoas',
];

describe('abas do painel Plantae', () => {
  it.each([
    ['GESTOR com plantae:read', RIZOLA],
    ['ADMIN', ADMIN],
  ])('%s ve as cinco abas, e abrir cada uma nao consulta nada', async (_nome, me) => {
    const fetchMock = mockApi(session(me));
    renderAt('/plantae');

    for (const aba of ABAS) {
      await userEvent.click(await screen.findByRole('tab', { name: aba }));
      expect(screen.getByRole('tab', { name: aba })).toHaveAttribute('aria-selected', 'true');
    }

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(ABAS);
    expect(plantaeCalls(fetchMock)).toBe(0);
  });

  it('trocar de aba descarta dados e filtros da anterior, sem nova consulta', async () => {
    const fetchMock = mockApi(
      session(RIZOLA, {
        [PLANTAE.movements]: { status: 200, body: list([makeMovement()]) },
      }),
    );
    renderAt('/plantae');
    await userEvent.click(await screen.findByRole('tab', { name: 'Movimentações' }));
    await userEvent.selectOptions(screen.getByLabelText('Natureza'), 'D');
    await consultar();
    expect(await screen.findByText('Pagamento ficticio')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Pessoas' }));
    expect(screen.queryByText('Pagamento ficticio')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Movimentações' }));

    expect(await screen.findByRole('button', { name: 'Consultar' })).toBeInTheDocument();
    expect(screen.queryByText('Pagamento ficticio')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Natureza')).toHaveValue('');
    expect(callsTo(fetchMock, PLANTAE.movements)).toHaveLength(1);
  });

  it('resposta que chega depois de trocar de aba e descartada', async () => {
    let liberar: (body: unknown) => void = () => undefined;
    const pendente: Handler = () =>
      new Promise((resolve) => {
        liberar = (body) => {
          resolve({ status: 200, body });
        };
      });
    mockApi(session(RIZOLA, { [PLANTAE.movements]: pendente }));
    renderAt('/plantae');
    await userEvent.click(await screen.findByRole('tab', { name: 'Movimentações' }));
    await consultar();
    expect(await screen.findByRole('button', { name: 'Consultando…' })).toBeDisabled();

    await userEvent.click(screen.getByRole('tab', { name: 'Contas bancárias' }));
    liberar(list([makeMovement({ descricao: 'Chegou tarde' })]));
    await userEvent.click(screen.getByRole('tab', { name: 'Movimentações' }));

    expect(await screen.findByRole('button', { name: 'Consultar' })).toBeEnabled();
    expect(screen.queryByText('Chegou tarde')).not.toBeInTheDocument();
  });

  it('a aba de contas a pagar e receber continua sendo a inicial', async () => {
    mockApi(session(RIZOLA));
    renderAt('/plantae');

    expect(await screen.findByRole('tab', { name: 'Contas a pagar e receber' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Vencimento de')).toBeInTheDocument();
  });
});
