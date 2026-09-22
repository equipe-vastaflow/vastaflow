import type { ReactNode } from 'react';
import type { UserCounts } from '../../api/client';

const CARDS: { key: keyof UserCounts; label: string; tone?: string }[] = [
  { key: 'total', label: 'Total de usuários' },
  { key: 'ativos', label: 'Usuários ativos', tone: 'stat-value-ok' },
  { key: 'inativos', label: 'Usuários inativos', tone: 'stat-value-off' },
];

/** Contagem de usuarios. So aparece para quem tem `users:read`. */
export function UserStatsCards({ counts }: { counts: UserCounts }): ReactNode {
  return (
    <section aria-labelledby="titulo-usuarios">
      <h2 id="titulo-usuarios">Usuários</h2>
      <div className="stat-grid">
        {CARDS.map(({ key, label, tone }) => (
          <article key={key} className="card stat-card">
            <p className="stat-label">{label}</p>
            {/* O rotulo ja nomeia o numero; o par e lido junto pelo leitor de tela. */}
            <p className={tone ? `stat-value ${tone}` : 'stat-value'}>{counts[key]}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
