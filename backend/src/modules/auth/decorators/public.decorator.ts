import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Libera a rota da autenticacao.
 *
 * O `JwtAuthGuard` e global e nega por padrao: toda rota nova nasce protegida
 * e so fica aberta se receber este decorator de forma explicita.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
