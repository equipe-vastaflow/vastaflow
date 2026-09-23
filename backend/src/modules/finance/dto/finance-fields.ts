import { Transform } from 'class-transformer';

/**
 * Remove espacos nas pontas antes da validacao.
 *
 * Com isto, `"   "` chega vazio ao `@IsNotEmpty()` e e recusado - texto so de
 * espacos nao passa por descuido. Mesma abordagem usada nos DTOs de usuario.
 */
export const TrimString = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );
