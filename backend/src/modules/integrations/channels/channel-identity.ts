import type { AuthenticatedUser } from '../../auth/auth.types';
import type { ExternalIdentity } from './incoming-message';

/**
 * Traduz uma identidade externa (remetente no Telegram, no WhatsApp) para um
 * usuario INTERNO autenticado - ou para `null`, quando nao ha vinculo.
 *
 * E o unico ponto do sistema autorizado a fazer essa passagem. Recebe somente a
 * identidade externa: nada do conteudo da mensagem entra na decisao, entao um
 * texto como `{"userId": "..."}` nao tem como escolher o usuario.
 *
 * `null` significa "nao vinculado": o adaptador NAO executa comando nenhum.
 *
 * Contrato para quem implementar a vinculacao: devolver somente usuario ATIVO,
 * relido do banco a cada mensagem - o mesmo criterio do `JwtAuthGuard`, para que
 * desativar a conta ou trocar o perfil valha tambem neste canal.
 */
export interface ChannelIdentityResolver {
  resolve(identity: ExternalIdentity): Promise<AuthenticatedUser | null>;
}

/** Token de injecao do resolvedor usado pelos adaptadores de canal. */
export const CHANNEL_IDENTITY_RESOLVER = Symbol('CHANNEL_IDENTITY_RESOLVER');
