import { ApiProperty } from '@nestjs/swagger';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import type { SettingValue } from '../setting-value';

/**
 * Aceita apenas os tres escalares suportados - texto, numero ou booleano.
 *
 * Objeto, lista e `null` sao recusados aqui, antes de qualquer regra de
 * negocio. A compatibilidade com o `tipo` DECLARADO da configuracao e checada
 * depois, no `SettingsService`, que e quem sabe qual chave esta sendo alterada.
 *
 * Existe como validador proprio porque o `class-validator` nao tem um decorator
 * de uniao, e sem NENHUM decorator o `whitelist: true` do `ValidationPipe`
 * removeria o campo do DTO em silencio.
 */
export function IsSettingValue(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isSettingValue',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          );
        },
        defaultMessage(): string {
          return 'valor deve ser um texto, um numero ou um booleano';
        },
      },
    });
  };
}

/**
 * Alteracao de uma configuracao.
 *
 * SOMENTE o valor. `chave`, `tipo`, `descricao` e o responsavel ficam de fora
 * de proposito: os tres primeiros vem do catalogo em codigo e o ultimo vem do
 * JWT. Como o `ValidationPipe` global roda com `forbidNonWhitelisted`, enviar
 * qualquer um deles resulta em 400.
 */
export class UpdateSettingDto {
  @ApiProperty({
    description:
      'Novo valor, no tipo declarado pela configuracao. Um texto "true" NAO e aceito numa ' +
      'configuracao BOOLEAN - o tipo do JSON precisa corresponder.',
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    examples: ['VastaFlow', 20, true],
  })
  @IsSettingValue()
  valor: SettingValue;
}
