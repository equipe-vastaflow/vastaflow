import { MESSAGE_MAX_LENGTH, TITLE_MAX_LENGTH } from './entities/notification.entity';
import { NotificationType } from './notification.enums';

/** Conteudo de uma notificacao nova, como outro modulo a informa. */
export interface NewNotificationInput {
  usuarioId: string;
  titulo: string;
  mensagem: string;
  tipo: NotificationType;
}

/** Sucesso traz o conteudo ja normalizado; falha traz a mensagem para o 400. */
export type ValidatedNotification =
  { ok: true; value: NewNotificationInput } | { ok: false; erro: string };

/**
 * Valida e normaliza o conteudo de uma notificacao.
 *
 * Existe porque `createForUser` NAO passa pelo `ValidationPipe`: ela e chamada
 * de dentro do sistema, por outro modulo, e nao por uma requisicao HTTP. Sem
 * esta checagem, um titulo vazio ou uma mensagem maior que a coluna so
 * apareceriam como erro do banco, tarde demais.
 *
 * Funcao pura, sem excecao de framework: quem chama decide o que fazer com a
 * recusa (mesma abordagem de `entry-status.policy.ts` e `setting-value.ts`).
 */
export function validateNotification(input: NewNotificationInput): ValidatedNotification {
  const usuarioId = input.usuarioId.trim();
  if (usuarioId === '') {
    return { ok: false, erro: 'usuarioId e obrigatorio' };
  }

  const titulo = input.titulo.trim();
  if (titulo === '') {
    return { ok: false, erro: 'titulo e obrigatorio' };
  }
  if (titulo.length > TITLE_MAX_LENGTH) {
    return { ok: false, erro: `titulo deve ter no maximo ${TITLE_MAX_LENGTH} caracteres` };
  }

  const mensagem = input.mensagem.trim();
  if (mensagem === '') {
    return { ok: false, erro: 'mensagem e obrigatoria' };
  }
  if (mensagem.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, erro: `mensagem deve ter no maximo ${MESSAGE_MAX_LENGTH} caracteres` };
  }

  if (!Object.values(NotificationType).includes(input.tipo)) {
    return {
      ok: false,
      erro: `tipo deve ser um destes valores: ${Object.values(NotificationType).join(', ')}`,
    };
  }

  return { ok: true, value: { usuarioId, titulo, mensagem, tipo: input.tipo } };
}
