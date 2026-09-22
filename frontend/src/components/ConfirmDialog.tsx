import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Destaca a acao como destrutiva (ex.: desativar). */
  danger?: boolean;
  busy?: boolean;
  /** Desabilita a confirmacao (ex.: nada selecionado ainda). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Janela modal de confirmacao. Esc e o botao Cancelar fecham; o foco vai para
 * Cancelar ao abrir, para um Enter acidental nao confirmar a acao.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactNode {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) {
        onCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onCancel]);

  return (
    <div className="dialog-backdrop">
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={danger ? 'button button-danger' : 'button'}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
