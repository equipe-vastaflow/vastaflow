import { Injectable } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { toAuthenticatedUser } from '../auth/authenticated-user';
import { parseCommand } from '../commands/command-parser';
import {
  type ChannelLinkConfirmer,
  LinkConfirmationOutcome,
} from '../integrations/channels/channel-link';
import type { ExternalIdentity } from '../integrations/channels/incoming-message';
import { UsersService } from '../users/users.service';
import { IdentityChannel } from './external-identity.enums';
import { IdentityLinkRequestsRepository } from './identity-link-requests.repository';
import { hashLinkCode, normalizeLinkCode } from './link-code';

/** O comando de confirmacao. Unico argumento: o codigo. */
export const LINK_COMMAND = 'vincular';

/** Canal do remetente (texto) -> canal vinculavel, sem cast. */
const CHANNELS = new Map<string, IdentityChannel>(
  Object.values(IdentityChannel).map((c) => [c, c]),
);

/**
 * Confirmacao de posse: `/vincular <codigo>` enviado PELA PROPRIA conta externa.
 *
 * - o texto e interpretado pelo parser do Command Engine (`parseCommand`) - nao
 *   ha parser proprio;
 * - a identidade externa vem do REMETENTE (`sender`), nunca de um argumento;
 * - o usuario interno vem da SOLICITACAO pendente, nunca da mensagem;
 * - exatamente um argumento: `/vincular 123 <userId>` nem e considerado.
 *
 * Todo codigo invalido, expirado, ja usado ou de usuario inativo produz o mesmo
 * `Rejected`, sem distincao - nada se aprende sobre os codigos existentes. O
 * codigo nunca vai para log nem auditoria.
 */
@Injectable()
export class LinkConfirmationService implements ChannelLinkConfirmer {
  constructor(
    private readonly requests: IdentityLinkRequestsRepository,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  async tryConfirm(sender: ExternalIdentity, text: string): Promise<LinkConfirmationOutcome> {
    const parsed = parseCommand(text);
    if (parsed.kind !== 'command' || parsed.command.name !== LINK_COMMAND) {
      return LinkConfirmationOutcome.NotAttempted;
    }

    const channel = CHANNELS.get(sender.channel);
    const code =
      parsed.command.args.length === 1 ? normalizeLinkCode(parsed.command.args[0]) : null;
    if (!channel || code === null) {
      return LinkConfirmationOutcome.Rejected;
    }

    const request = await this.requests.findByCodeHash(hashLinkCode(code));
    if (
      !request ||
      request.canal !== channel ||
      request.expiraEm.getTime() <= Date.now() ||
      // Usuario inativo (ou removido) nao recebe vinculo - mesma regra do JWT.
      !toAuthenticatedUser(await this.usersService.findById(request.usuarioId))
    ) {
      return LinkConfirmationOutcome.Rejected;
    }

    // O estado PENDENTE e conferido no UPDATE atomico, nao aqui.
    const result = await this.requests.confirmAndLink(request, sender.externalId);
    switch (result.kind) {
      case 'not-pending':
        return LinkConfirmationOutcome.Rejected;
      case 'identity-taken':
        return LinkConfirmationOutcome.AlreadyLinked;
      case 'confirmed':
        break;
    }

    // Quem age e o proprio usuario vinculado, pela conta externa. Sem o codigo.
    await this.auditService.record({
      usuarioId: request.usuarioId,
      acao: AuditAction.ExternalIdentityLinked,
      modulo: AuditModuleName.Users,
      descricao: `Identidade ${channel} vinculada por confirmacao da propria conta`,
      metadados: {
        alvoId: request.usuarioId,
        solicitacaoId: request.id,
        vinculoId: result.link.id,
        canal: channel,
        idExterno: sender.externalId,
      },
    });
    return LinkConfirmationOutcome.Confirmed;
  }
}
