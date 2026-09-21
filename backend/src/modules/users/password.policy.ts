import { isStrongPassword, registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * O bcrypt considera apenas os primeiros 72 BYTES da senha; o excedente e
 * ignorado em silencio. Rejeitar acima disso evita que duas senhas diferentes
 * sejam tratadas como iguais.
 */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_POLICY_MESSAGE =
  `A senha deve ter de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_BYTES} caracteres, ` +
  'com ao menos uma letra maiuscula, uma minuscula e um numero';

/** Politica de senha aplicada no cadastro (e no administrador inicial). */
export function isPasswordValid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES &&
    isStrongPassword(value, {
      minLength: PASSWORD_MIN_LENGTH,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 0,
    })
  );
}

/** Decorator de DTO equivalente a `isPasswordValid`. */
export function IsValidPassword(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isValidPassword',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: PASSWORD_POLICY_MESSAGE, ...options },
      validator: { validate: isPasswordValid },
    });
  };
}
