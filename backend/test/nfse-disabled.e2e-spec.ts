import type http from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CommandResultResponseDto } from '../src/modules/commands/dto/command-result-response.dto';
import { NfseEmission } from '../src/modules/integrations/nfse/nfse-emission.entity';
import { createTestApp } from './support/test-app';

/** Padrao de fabrica: NFS-e DESLIGADA. Nem o ADMIN consegue pedir, confirmar ou consultar. */
describe('NFS-e desligada por padrao (e2e)', () => {
  let app: INestApplication;
  let jwt: string;

  const server = (): http.Server => app.getHttpServer() as http.Server;

  async function execute(text: string): Promise<CommandResultResponseDto> {
    const response = await request(server())
      .post('/commands/execute')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ text })
      .expect(200);
    return response.body as CommandResultResponseDto;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const login = await request(server())
      .post('/auth/login')
      .send({ email: 'admin@vasta.test', senha: 'AdminSenha1' })
      .expect(200);
    jwt = (login.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('o ambiente de teste nao liga a NFS-e', () => {
    expect(process.env.NFSE_ENABLED).not.toBe('true');
  });

  it('os tres comandos respondem "desligada" e nada e criado', async () => {
    for (const text of [
      '/nfse tomador=52998224725 nome=Maria valor=10 servico=010101 desc=x iss=1 ret=1 local=3106200',
      '/nfse_confirmar 1 ABCDEFGH',
      '/nfse_status',
    ]) {
      const result = await execute(text);
      expect(result).toMatchObject({ success: false });
      expect(result.reply).toMatch(/desligada/);
    }
    const repository = app.get<Repository<NfseEmission>>(getRepositoryToken(NfseEmission), {
      strict: false,
    });
    expect(await repository.count()).toBe(0);
  });
});
