import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersRepository } from './users.repository';

/**
 * Dados pessoais do PROPRIO usuario (`/profile`).
 *
 * O alvo e sempre o usuario autenticado: o unico identificador que este codigo
 * conhece e `actor.id`, que vem do JWT. Nao existe parametro de usuario em
 * lugar nenhum deste caminho - nem na rota, nem na query, nem no corpo -, entao
 * nao ha "perfil de outra pessoa" a que chegar.
 *
 * A gravacao e um UPDATE DIRECIONADO (`UsersRepository.updateName`), e nao um
 * `save(entity)`. A diferenca e de seguranca, nao de estilo: o `save` compara a
 * entidade carregada com a linha atual e reescreve toda coluna que diferir,
 * entao uma desativacao ou um rebaixamento de perfil feitos entre a leitura e a
 * gravacao seriam revertidos pelo PATCH. Com o UPDATE direcionado, `ativo`,
 * `role_id`, `senha_hash` e `email` nao aparecem no comando.
 *
 * NAO reusa `UserManagementService.update`, por duas razoes concretas:
 *
 * 1. aquele metodo aplica a regra de hierarquia (`canManageUser`), que recusa
 *    alguem com o MESMO perfil - ou seja, recusaria todo mundo editando a si
 *    mesmo, que e exatamente o caso aqui;
 * 2. aquele metodo aceita `email`, que esta fora do escopo do perfil.
 *
 * A auditoria e BEST-EFFORT, como no resto do sistema: e gravada depois da
 * alteracao e uma falha ao grava-la vai para o log sem desfazer a operacao nem
 * mudar a resposta. Alteracao sem efeito (nada enviado, ou o mesmo valor)
 * responde normalmente e NAO gera registro.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Altera os dados pessoais do proprio usuario.
   *
   * Nao ha leitura adicional: o `JwtAuthGuard` ja releu o usuario do banco
   * nesta requisicao, e `actor` e o resultado dessa leitura. A existencia da
   * conta e conferida pelo proprio UPDATE - se nenhuma linha for alcancada, a
   * conta sumiu entre a autenticacao e a gravacao.
   *
   * @returns o usuario com o nome ja atualizado, para a resposta.
   * @throws NotFoundException conta apagada entre a autenticacao e a gravacao.
   */
  async update(
    actor: AuthenticatedUser,
    dto: UpdateProfileDto,
    ip: string | null,
  ): Promise<AuthenticatedUser> {
    // Somente os campos REALMENTE enviados, e so quando mudam de valor. Nada
    // enviado, ou o mesmo nome: nenhum UPDATE e nenhum registro de auditoria.
    // `actor.nome` e o valor lido do banco pelo guard nesta requisicao.
    const nome = dto.nome;
    if (nome === undefined || nome === actor.nome) {
      return actor;
    }
    // Um campo editavel hoje; quando houver mais, esta lista passa a ser
    // montada campo a campo, como no financeiro.
    const campos = ['nome'];

    const quando = new Date();
    // `actor.id` e a UNICA origem do identificador: vem do JWT, nunca do corpo.
    const alcancadas = await this.repository.updateName(actor.id, nome, quando);
    if (alcancadas === 0) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    await this.auditService.record({
      usuarioId: actor.id,
      // Reusa a acao que ja existe para "os dados de um usuario mudaram". O que
      // distingue a edicao do proprio perfil de uma edicao administrativa e
      // `usuarioId === metadados.alvoId` - nenhuma acao nova foi criada.
      acao: AuditAction.UserUpdated,
      modulo: AuditModuleName.Users,
      // Sem e-mail e sem nome: quem executou ja esta em `usuarioId`, e a tela
      // de auditoria resolve o nome a partir dele. Dado pessoal nao precisa
      // estar duplicado na trilha.
      descricao: 'Perfil proprio atualizado',
      ip,
      // Apenas os NOMES dos campos alterados - nunca os valores, antigos ou
      // novos. Mesmo criterio do financeiro.
      metadados: { alvoId: actor.id, campos },
    });

    // As demais colunas nao foram tocadas, entao o restante do `actor` (lido do
    // banco pelo guard nesta requisicao) continua valendo.
    return { ...actor, nome, updatedAt: quando };
  }
}
