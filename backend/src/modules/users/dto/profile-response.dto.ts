import { ApiProperty } from '@nestjs/swagger';
import { RoleName } from '../../roles/role-name.enum';
import type { AuthenticatedUser } from '../../auth/auth.types';

/**
 * O proprio perfil, como `/profile` o devolve.
 *
 * Contrato PROPRIO, separado de `UserResponseDto` (`/auth/me`, `/users`): ali o
 * que importa e o material de autorizacao - inclusive a lista de permissoes -,
 * aqui o que importa sao os dados pessoais. `permissions` fica de fora: a tela
 * de perfil nao decide acesso, e o `AuthContext` ja tem essa lista de `/auth/me`.
 *
 * `role` e `ativo` vem juntos, mas so para LEITURA: a tela os mostra e nao
 * oferece edicao. Quem os altera e a administracao de usuarios, com regra de
 * hierarquia. Lista explicita de campos (nunca `...user`) para que o hash da
 * senha, ou qualquer coluna sensivel futura, so apareca se alguem a incluir de
 * proposito - mesmo criterio de `UserResponseDto`.
 */
export class ProfileResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Somente leitura' })
  id: string;

  @ApiProperty({ example: 'Maria Silva', description: 'Unico campo editavel por `PATCH /profile`' })
  nome: string;

  @ApiProperty({
    example: 'maria@example.com',
    description: 'Somente leitura: trocar de e-mail exige um fluxo de confirmacao que nao existe',
  })
  email: string;

  @ApiProperty({ enum: RoleName, description: 'Somente leitura: alterado por `/users/:id/role`' })
  role: RoleName;

  @ApiProperty({ description: 'Somente leitura: alterado por `/users/:id/status`' })
  ativo: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}

/**
 * Recorta o usuario autenticado nos campos do perfil.
 *
 * A entrada e sempre o `AuthenticatedUser` - o que o `JwtAuthGuard` leu do
 * banco nesta requisicao, ou ele com o nome ja atualizado. O `PATCH` nao
 * recarrega a entity: a gravacao toca apenas `nome`, entao as demais colunas
 * continuam valendo.
 */
export function toProfileResponse(user: AuthenticatedUser): ProfileResponseDto {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    ativo: user.ativo,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
