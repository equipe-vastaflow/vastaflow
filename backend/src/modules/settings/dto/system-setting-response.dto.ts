import { ApiProperty } from '@nestjs/swagger';
import type { UserIdentity } from '../../users/user-directory.service';
import type { SettingWithActor } from '../settings.service';
import type { SettingValue } from '../setting-value';
import { SystemSettingType } from '../system-setting.enums';

/** Quem alterou o valor pela ultima vez. */
export class SettingActorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Maria Silva' })
  nome: string;

  @ApiProperty({ example: 'maria@example.com' })
  email: string;
}

/**
 * Configuracao como a API a devolve.
 *
 * O identificador publico e a `chave`; o `id` da linha nao e exposto, porque
 * nenhuma rota o utiliza. Nao existe campo de segredo: o que esta aqui e todo
 * o conteudo da configuracao.
 */
export class SystemSettingResponseDto {
  @ApiProperty({ example: 'SYSTEM_NAME' })
  chave: string;

  @ApiProperty({
    description: 'Ja convertido conforme o `tipo` - texto, numero ou booleano',
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    examples: ['VastaFlow', 20, true],
  })
  valor: SettingValue;

  @ApiProperty({ example: 'Nome do sistema exibido nas telas e nos relatorios' })
  descricao: string;

  @ApiProperty({ enum: SystemSettingType })
  tipo: SystemSettingType;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Id de quem alterou por ultimo. Nulo enquanto o valor for o padrao inicial.',
  })
  atualizadoPorId: string | null;

  @ApiProperty({
    type: SettingActorDto,
    nullable: true,
    description:
      'Responsavel identificado. Nulo quando ninguem alterou ainda ou quando o usuario nao ' +
      'existe mais - `atualizadoPorId` continua preenchido.',
  })
  atualizadoPor: SettingActorDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time', description: 'Quando o valor foi alterado pela ultima vez' })
  updatedAt: Date;
}

export function toSystemSettingResponse({
  setting,
  valor,
  atualizadoPor,
}: SettingWithActor): SystemSettingResponseDto {
  return {
    chave: setting.chave,
    valor,
    descricao: setting.descricao,
    tipo: setting.tipo,
    atualizadoPorId: setting.atualizadoPorId,
    atualizadoPor: toActor(atualizadoPor),
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt,
  };
}

function toActor(autor?: UserIdentity): SettingActorDto | null {
  return autor ? { id: autor.id, nome: autor.nome, email: autor.email } : null;
}
