import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { CreatedIdentityLinkRequest } from '../../api/client';
import { CHANNEL_LABELS } from './external-identity-format';
import { formatDateTime } from './format';

/**
 * Mostra o código de vinculação, uma única vez.
 *
 * Não reutiliza o `ConfirmDialog` porque aqui não há nada a confirmar: é uma
 * exibição com um único botão de fechar. O que é reaproveitado são as classes e
 * o comportamento de acessibilidade dele - `role="dialog"`, `aria-modal`,
 * título associado por `aria-labelledby`, foco no botão ao abrir e Esc fechando.
 *
 * O código vive apenas na prop, que vem de estado React do componente pai e é
 * descartada ao fechar. Nada é gravado em `localStorage`, `sessionStorage`, URL
 * ou histórico, e nada é registrado em log.
 */
export function LinkCodeDialog({
  request,
  onClose,
}: {
  request: CreatedIdentityLinkRequest;
  onClose: () => void;
}): ReactNode {
  const titleId = useId();
  const codeId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop">
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Vinculação do {CHANNEL_LABELS[request.canal]}</h2>
        <div className="dialog-body">
          <p>
            Envie o código abaixo ao bot do {CHANNEL_LABELS[request.canal]}, em conversa privada,{' '}
            <strong>pela própria conta que será vinculada</strong>.
          </p>

          {/* O código é o conteúdo principal do diálogo: fica em elemento
              próprio, legível, e é anunciado por leitor de tela. */}
          <p className="link-code mono" id={codeId} aria-label={`Código: ${request.codigo}`}>
            {request.codigo}
          </p>

          <p className="muted">{request.instrucao}</p>

          <p>
            Válido até <strong>{formatDateTime(request.expiraEm)}</strong>. O código é temporário e{' '}
            <strong>não será mostrado novamente</strong> — se perdê-lo, cancele a solicitação e
            inicie outra.
          </p>
        </div>
        <div className="dialog-actions">
          <button ref={closeRef} type="button" className="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
