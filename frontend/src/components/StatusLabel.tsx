import type { ReactNode } from 'react';

export function StatusLabel({ ativo }: { ativo: boolean }): ReactNode {
  return (
    <span>
      <span className={ativo ? 'status-dot' : 'status-dot status-dot-off'} aria-hidden="true" />
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}
