import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { toAuthenticatedUser } from '../auth/authenticated-user';
import type { ChannelIdentityResolver } from '../integrations/channels/channel-identity';
import type { ExternalIdentity } from '../integrations/channels/incoming-message';
import { UsersService } from '../users/users.service';
import { ExternalIdentitiesRepository } from './external-identities.repository';

/**
 * Resolvedor de identidade baseado nos vinculos persistidos.
 *
 * A UNICA associacao possivel e: `(channel, externalId)` -> vinculo -> usuario
 * interno. Recebe so a identidade externa, que o adaptador tira do remetente -
 * nada do texto, do payload nem de argumento de comando chega aqui.
 *
 * O usuario e relido do banco a cada mensagem e passa pela MESMA regra do
 * `JwtAuthGuard` (`toAuthenticatedUser`): inativo ou inexistente vira `null`,
 * e perfil/permissoes sao os atuais. Nao ha cache - remover o vinculo ou
 * desativar a conta vale na proxima mensagem.
 *
 * Erro de banco propaga: o adaptador o trata como "nao vinculado", nunca como
 * acesso liberado.
 */
@Injectable()
export class DatabaseIdentityResolver implements ChannelIdentityResolver {
  constructor(
    private readonly links: ExternalIdentitiesRepository,
    private readonly usersService: UsersService,
  ) {}

  async resolve(identity: ExternalIdentity): Promise<AuthenticatedUser | null> {
    const link = await this.links.findByIdentity(identity.channel, identity.externalId);
    if (!link) {
      return null;
    }
    return toAuthenticatedUser(await this.usersService.findById(link.usuarioId));
  }
}
