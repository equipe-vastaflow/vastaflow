import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RoleName } from '../../roles/role-name.enum';
import { IsValidPassword, PASSWORD_POLICY_MESSAGE } from '../password.policy';
import { NormalizeEmail, TrimString } from './user-fields';

/** Criacao administrativa de usuario (`POST /users`). */
export class CreateUserDto {
  @ApiProperty({ example: 'Maria Silva' })
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome' })
  @MaxLength(120)
  nome: string;

  @ApiProperty({ example: 'maria@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Informe um e-mail valido' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Senha@1234', description: PASSWORD_POLICY_MESSAGE })
  @IsValidPassword()
  senha: string;

  @ApiPropertyOptional({
    enum: RoleName,
    default: RoleName.Usuario,
    description: 'Perfil inicial. So e aceito um perfil que o autor da requisicao pode conceder.',
  })
  @IsOptional()
  @IsEnum(RoleName, {
    message: `role deve ser um destes valores: ${Object.values(RoleName).join(', ')}`,
  })
  role?: RoleName;
}
