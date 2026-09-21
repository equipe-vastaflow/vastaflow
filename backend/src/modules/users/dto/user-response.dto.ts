import { ApiProperty } from '@nestjs/swagger';
import { RoleName } from '../../roles/role-name.enum';
import type { User } from '../entities/user.entity';

/** Representacao publica de um usuario. Nunca inclui o hash da senha. */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Maria Silva' })
  nome: string;

  @ApiProperty({ example: 'maria@vasta.com.br' })
  email: string;

  @ApiProperty({ enum: RoleName, example: RoleName.Usuario })
  role: RoleName;

  @ApiProperty({
    type: [String],
    example: ['users:read'],
    description: 'Permissoes granulares concedidas pelo perfil',
  })
  permissions: string[];

  @ApiProperty()
  ativo: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/** Espera `role` e `role.permissions` carregados. */
export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role.nome,
    permissions: user.role.permissions.map((permission) => permission.code),
    ativo: user.ativo,
    createdAt: user.createdAt,
  };
}
