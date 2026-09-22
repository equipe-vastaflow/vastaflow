import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail, TrimString } from './user-fields';

/**
 * Edicao de dados cadastrais (`PATCH /users/:id`).
 *
 * Aceita apenas nome e e-mail. Senha, perfil e status NAO passam por aqui: o
 * `ValidationPipe` global (`forbidNonWhitelisted`) rejeita com 400 qualquer
 * outro campo. Perfil e status tem rotas proprias, com regras proprias; troca
 * de senha ainda nao tem fluxo definido.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Maria Souza' })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'O nome nao pode ficar vazio' })
  @MaxLength(120)
  nome?: string;

  @ApiPropertyOptional({ example: 'maria.souza@example.com' })
  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'Informe um e-mail valido' })
  @MaxLength(254)
  email?: string;
}
