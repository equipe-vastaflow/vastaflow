import { toUserResponse } from '../users/dto/user-response.dto';
import type { User } from '../users/entities/user.entity';
import type { AuthenticatedUser } from './auth.types';

/**
 * Regra UNICA de "este usuario pode agir no sistema agora": existe e esta
 * ativo. Devolve o `AuthenticatedUser` montado a partir do usuario lido do banco
 * nesta chamada - perfil e permissoes sao os atuais, nunca uma copia antiga.
 *
 * Usada pelo `JwtAuthGuard` (requisicao HTTP) e pelo resolvedor de identidade
 * externa (canais de mensageria): desativar a conta ou trocar o perfil vale nos
 * dois caminhos ao mesmo tempo, sem regra duplicada.
 *
 * `null` para inexistente e para inativo, sem distinguir - quem chama nao deve
 * revelar o estado da conta.
 */
export function toAuthenticatedUser(user: User | null): AuthenticatedUser | null {
  return user?.ativo ? toUserResponse(user) : null;
}
