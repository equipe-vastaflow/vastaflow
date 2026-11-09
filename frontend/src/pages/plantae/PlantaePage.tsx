import { useState, type ReactNode } from 'react';
import { AppShell } from '../../components/AppShell';
import { AccountsTab } from './AccountsTab';
import { EntriesTab } from './EntriesTab';
import { MovementsTab } from './MovementsTab';
import { PeopleTab } from './PeopleTab';
import { StatementTab } from './StatementTab';

/** Abas do painel, na ordem em que aparecem. */
const TABS = [
  { id: 'lancamentos', label: 'Contas a pagar e receber', Panel: EntriesTab },
  { id: 'movimentacoes', label: 'Movimentações', Panel: MovementsTab },
  { id: 'extratos', label: 'Extratos', Panel: StatementTab },
  { id: 'contas', label: 'Contas bancárias', Panel: AccountsTab },
  { id: 'pessoas', label: 'Pessoas', Panel: PeopleTab },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Consultas ao Plantae em tempo real, somente leitura (`plantae:read`).
 *
 * Cada aba consulta o backend do VastaFlow, que fala com o Plantae; nada e
 * gravado no VastaFlow nem no navegador. Documentos pessoais chegam mascarados
 * pelo backend.
 *
 * So a aba ativa fica montada: trocar de aba DESCARTA os filtros e os dados da
 * anterior (estao so na memoria dela), e nenhuma aba consulta ao abrir.
 */
export function PlantaePage(): ReactNode {
  const [active, setActive] = useState<TabId>('lancamentos');
  const { Panel } = TABS.find((tab) => tab.id === active) ?? TABS[0];

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Plantae</h1>
          <p className="muted">Consultas financeiras da organização no Plantae.</p>
        </div>
      </div>

      <p className="notice" role="note">
        Dados consultados no Plantae em tempo real. Somente leitura.
      </p>

      <div className="row-actions" role="tablist" aria-label="Consultas do Plantae">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`plantae-aba-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={active === tab.id ? `plantae-painel-${tab.id}` : undefined}
            className={
              active === tab.id ? 'button button-small' : 'button button-secondary button-small'
            }
            onClick={() => {
              setActive(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`plantae-painel-${active}`}
        aria-labelledby={`plantae-aba-${active}`}
      >
        {/* `key`: garante estado novo a cada troca, mesmo se dois paineis um dia
            compartilharem componente. */}
        <Panel key={active} />
      </div>
    </AppShell>
  );
}
