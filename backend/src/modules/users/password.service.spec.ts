import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  // Custo minimo: os testes verificam o comportamento, nao a forca do hash.
  const config = {
    get: jest.fn().mockReturnValue(4),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const service = new PasswordService(config);

  it('gera um hash bcrypt diferente da senha original', async () => {
    const hash = await service.hash('Senha1234');

    expect(hash).not.toBe('Senha1234');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
  });

  it('gera hashes distintos para a mesma senha (salt aleatorio)', async () => {
    expect(await service.hash('Senha1234')).not.toBe(await service.hash('Senha1234'));
  });

  it('confere a senha correta e recusa a incorreta', async () => {
    const hash = await service.hash('Senha1234');

    await expect(service.verify('Senha1234', hash)).resolves.toBe(true);
    await expect(service.verify('senha1234', hash)).resolves.toBe(false);
  });

  it('sem hash (usuario inexistente) sempre recusa', async () => {
    await expect(service.verify('Senha1234', undefined)).resolves.toBe(false);
  });
});
