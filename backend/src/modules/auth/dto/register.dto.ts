import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsValidPassword, PASSWORD_POLICY_MESSAGE } from '../../users/password.policy';

/**
 * Cadastro publico. Nao aceita `role`: `forbidNonWhitelisted` rejeita o campo,
 * e todo usuario criado por aqui nasce como USUARIO. O primeiro administrador
 * vem do seed (`SEED_ADMIN_*`).
 */
export class RegisterDto {
  @ApiProperty({ example: 'Maria Silva' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome' })
  @MaxLength(120)
  nome: string;

  @ApiProperty({ example: 'maria@vasta.com.br' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Informe um e-mail valido' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Senha@1234', description: PASSWORD_POLICY_MESSAGE })
  @IsValidPassword()
  senha: string;
}
