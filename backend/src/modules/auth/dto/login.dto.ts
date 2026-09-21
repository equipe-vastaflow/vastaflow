import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'maria@vasta.com.br' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Informe um e-mail valido' })
  @MaxLength(254)
  email: string;

  /** Sem regra de complexidade aqui: no login so importa se confere com o hash. */
  @ApiProperty({ example: 'Senha@1234' })
  @IsString()
  @IsNotEmpty({ message: 'Informe a senha' })
  @MaxLength(128)
  senha: string;
}
