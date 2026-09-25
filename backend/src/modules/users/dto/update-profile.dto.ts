import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimString } from './user-fields';

/**
 * Edicao do proprio perfil (`PATCH /profile`).
 *
 * Tem UM campo porque, hoje, `nome` e o unico dado da entity `User` que o
 * proprio usuario pode alterar com seguranca:
 *
 * - `email` identifica a conta e e usado no login; trocar exige um fluxo de
 *   confirmacao que o sistema ainda nao tem. Fica somente leitura;
 * - `senha_hash` nao tem fluxo de troca definido;
 * - `role`, `ativo` e as permissoes sao dados ADMINISTRATIVOS, usados na
 *   autorizacao: quem os altera nao pode ser o proprio interessado. Continuam
 *   em `/users/:id/role` e `/users/:id/status`, com regra de hierarquia;
 * - `id`, `createdAt` e `updatedAt` nao sao editaveis por ninguem.
 *
 * NAO herda de `UpdateUserDto` de proposito: aquele DTO e administrativo e
 * aceita `email`. Herdar e remover campo depois e o tipo de heranca que deixa
 * um campo entrar de volta em silencio quando o DTO de origem cresce.
 *
 * O `ValidationPipe` global roda com `forbidNonWhitelisted`, entao qualquer
 * outro campo - `role`, `ativo`, `id`, `senha`, `userId` - resulta em 400. Eles
 * sao RECUSADOS pelo contrato, nunca ignorados em silencio.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Maria Souza', maxLength: 120 })
  @IsOptional()
  @TrimString()
  @IsString()
  @IsNotEmpty({ message: 'O nome nao pode ficar vazio' })
  @MaxLength(120)
  nome?: string;
}
