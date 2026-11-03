import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsValidPassword } from '../password.policy';

/**
 * Troca da PROPRIA senha (`POST /auth/change-password`).
 *
 * So estes dois campos: nao ha `id`, `email` nem qualquer identificador de usuario - o alvo e sempre
 * quem esta autenticado. O `ValidationPipe` global (`forbidNonWhitelisted`) recusa qualquer outro campo.
 */
export class ChangePasswordDto {
  /** Sem regra de complexidade: o que importa e se confere com o hash atual. */
  @ApiProperty({ description: 'Senha atual' })
  @IsString()
  @IsNotEmpty({ message: 'Informe a senha atual' })
  @MaxLength(128)
  senhaAtual: string;

  @ApiProperty({ description: 'Nova senha (mesma politica do cadastro)' })
  @IsString()
  @IsValidPassword()
  novaSenha: string;
}
