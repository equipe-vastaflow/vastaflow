import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Environment, type EnvironmentVariables } from '../../../config/env.validation';
import {
  PUBLIC_REGISTRATION_NOT_FOUND,
  PublicRegistrationGuard,
} from './public-registration.guard';

function guardEm(ambiente: Environment): PublicRegistrationGuard {
  const config = { get: (): Environment => ambiente } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
  return new PublicRegistrationGuard(config);
}

describe('PublicRegistrationGuard', () => {
  it('producao: recusa o cadastro publico com 404', () => {
    // 404, e nao 403, seguindo o criterio que o projeto ja usa em
    // `commands/non-production.guard.ts`: rota indisponivel em producao se
    // comporta como rota que nao existe.
    const guard = guardEm(Environment.Production);

    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('producao: a mensagem e a mesma que o Nest daria para rota inexistente', () => {
    const guard = guardEm(Environment.Production);

    expect(() => guard.canActivate()).toThrow(PUBLIC_REGISTRATION_NOT_FOUND);
    expect(PUBLIC_REGISTRATION_NOT_FOUND).toBe('Cannot POST /auth/register');
  });

  it('producao: a mensagem nao revela o motivo nem o ambiente', () => {
    expect(PUBLIC_REGISTRATION_NOT_FOUND).not.toMatch(
      /development|desenvolvimento|test|homolog|producao|desabilit|indisponiv|administrador/i,
    );
  });

  it('desenvolvimento: libera, para nao mudar o fluxo local', () => {
    expect(guardEm(Environment.Development).canActivate()).toBe(true);
  });

  it('teste: libera, porque os e2e exercitam o cadastro', () => {
    expect(guardEm(Environment.Test).canActivate()).toBe(true);
  });

  it('a decisao depende SOMENTE do NODE_ENV', () => {
    // Nenhuma variavel propria: nao ha configuracao que reabra o cadastro em
    // producao por engano. A prova e que o guard consulta uma unica chave.
    const consultadas: string[] = [];
    const config = {
      get: (chave: string): Environment => {
        consultadas.push(chave);
        return Environment.Production;
      },
    } as unknown as ConfigService<EnvironmentVariables, true>;

    expect(() => new PublicRegistrationGuard(config).canActivate()).toThrow(NotFoundException);
    expect(consultadas).toEqual(['NODE_ENV']);
  });
});
