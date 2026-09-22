import { Transform } from 'class-transformer';

/**
 * Transformacoes compartilhadas pelos DTOs que recebem nome e e-mail
 * (cadastro publico e administracao de usuarios).
 */
export const TrimString = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );

export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
