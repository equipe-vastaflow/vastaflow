import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment, type EnvironmentVariables } from '../../../config/env.validation';

/**
 * Resposta da recusa, no formato que o proprio Nest usa para rota inexistente.
 *
 * Igual ao que o framework devolveria se `POST /auth/register` nao existisse,
 * entao a resposta nao distingue "rota desativada" de "rota nao existe".
 */
export const PUBLIC_REGISTRATION_NOT_FOUND = 'Cannot POST /auth/register';

/**
 * Fecha o cadastro publico em producao.
 *
 * `POST /auth/register` cria conta sem autenticacao alguma. Num sistema interno
 * de uma empresa isso significaria que qualquer pessoa na internet poderia
 * criar um usuario - e o caminho correto ja existe: um administrador cria a
 * conta pelo modulo de usuarios, com perfil e permissoes definidos.
 *
 * A decisao vem SOMENTE do `NODE_ENV`, sem variavel propria, e isso e
 * deliberado: uma variavel de ambiente seria mais uma coisa a configurar errado,
 * e configurar errado aqui reabre o cadastro na internet. Sem variavel, nao ha
 * como reabrir por engano - so trocando codigo.
 *
 * Fora de producao o comportamento segue igual, porque os testes e2e existentes
 * exercitam o fluxo de cadastro.
 *
 * E um guard, e nao uma checagem no service, porque guard roda ANTES do
 * `ValidationPipe`: em producao a recusa e a mesma para corpo valido ou
 * invalido, entao a resposta nao revela nada sobre o formato esperado.
 *
 * Responde 404 (e nao 403) para seguir o criterio que o projeto ja adotou em
 * `modules/commands/non-production.guard.ts`: rota indisponivel em producao se
 * comporta como rota que nao existe. Os dois guards fazem a mesma coisa e
 * poderiam ser um unico guard compartilhado; unifica-los exigiria mexer no
 * modulo do Command Engine, que esta fora do escopo desta fase.
 */
@Injectable()
export class PublicRegistrationGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  canActivate(): boolean {
    if (this.config.get('NODE_ENV', { infer: true }) === Environment.Production) {
      throw new NotFoundException(PUBLIC_REGISTRATION_NOT_FOUND);
    }
    return true;
  }
}
