import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { Environment } from '../../config/env.validation';
import { NonProductionGuard } from './non-production.guard';

function guardFor(nodeEnv: Environment): NonProductionGuard {
  const config = { get: jest.fn().mockReturnValue(nodeEnv) };
  return new NonProductionGuard(config as unknown as ConfigService<EnvironmentVariables, true>);
}

describe('NonProductionGuard', () => {
  it.each([Environment.Development, Environment.Test])('libera a rota em %s', (nodeEnv) => {
    expect(guardFor(nodeEnv).canActivate()).toBe(true);
  });

  describe('em producao', () => {
    it('bloqueia a rota', () => {
      expect(() => guardFor(Environment.Production).canActivate()).toThrow(NotFoundException);
    });

    it('responde 404, para a rota parecer inexistente em vez de proibida', () => {
      try {
        guardFor(Environment.Production).canActivate();
        throw new Error('esperava que o guard bloqueasse');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getStatus()).toBe(404);
      }
    });

    it('nao revela o motivo do bloqueio na mensagem', () => {
      try {
        guardFor(Environment.Production).canActivate();
        throw new Error('esperava que o guard bloqueasse');
      } catch (error) {
        const message = (error as NotFoundException).message;
        expect(message).not.toMatch(/producao|production|NODE_ENV|ambiente/i);
      }
    });
  });

  it('le o NODE_ENV validado pelo ConfigService, nao o process.env cru', () => {
    const config = { get: jest.fn().mockReturnValue(Environment.Development) };
    const guard = new NonProductionGuard(
      config as unknown as ConfigService<EnvironmentVariables, true>,
    );

    guard.canActivate();

    expect(config.get).toHaveBeenCalledWith('NODE_ENV', { infer: true });
  });
});
