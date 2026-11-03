import { NFSE_PRESTADOR_CNPJ_PRODUCAO } from './support/nfse-env-producao';
import https from 'node:https';
import type http from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { Repository } from 'typeorm';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CommandResultResponseDto } from '../src/modules/commands/dto/command-result-response.dto';
import { NfseEmission } from '../src/modules/integrations/nfse/nfse-emission.entity';
import { createTestApp } from './support/test-app';

const ARGS =
  'tomador=52998224725 nome="Maria Teste" valor=100 servico=010101 desc="Servico ficticio de teste" iss=1 ret=1 local=3106200 totsn=12,5';
const BLOQUEIO = 'REDE-BLOQUEADA-PELO-TESTE';

/**
 * PRODUCAO REAL sem a autorizacao propria: NFSE_ENABLED=true e NFSE_WIRE_CONTRACT_CONFIRMED=true, destino = Sefin
 * oficial. Nenhum comando pode criar pedido, confirmar ou consultar, e NENHUMA conexao pode ser tentada.
 * `https.request` e interceptado ANTES da aplicacao subir (lanca): nada sai, nem se o portao falhar.
 */
describe('NFS-e: producao real sem autorizacao propria (e2e)', () => {
  let app: INestApplication;
  let jwt: string;
  let httpsRequest: jest.SpyInstance;

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
    httpsRequest = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error(BLOQUEIO);
    });
    app = await createTestApp();
    const login = await request(server())
      .post('/auth/login')
      .send({ email: 'admin@vasta.test', senha: 'AdminSenha1' })
      .expect(200);
    jwt = (login.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('pre-condicao: TUDO esta ligado, menos a autorizacao de producao', () => {
    expect(process.env.NFSE_ENABLED).toBe('true');
    expect(process.env.NFSE_AMBIENTE).toBe('producao');
    expect(process.env.NFSE_WIRE_CONTRACT_CONFIRMED).toBe('true');
    expect(process.env.NFSE_API_BASE_URL).toBeUndefined();
    expect(process.env.NFSE_PRODUCAO_AUTORIZACAO).toBeUndefined();
    expect(process.env.NFSE_PRESTADOR_CNPJ).toBe(NFSE_PRESTADOR_CNPJ_PRODUCAO);
  });

  it('sanidade: o interceptador de rede esta ativo neste teste', () => {
    expect(() => https.request('https://example.invalid')).toThrow(BLOQUEIO);
    httpsRequest.mockClear();
  });

  it.each([
    ['/nfse (pedido)', `/nfse ${ARGS}`],
    ['/nfse_confirmar', '/nfse_confirmar 1 ABCDEFGH'],
    ['/nfse_status', '/nfse_status'],
    ['/nfse_status com numero', '/nfse_status 1'],
  ])('ADMIN: %s e recusado (nao configurada) e NENHUMA conexao e tentada', async (_nome, text) => {
    const result = await execute(text);

    expect(result.success).toBe(false);
    expect(result.reply).toMatch(/nao esta configurada corretamente/);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('nada foi criado no banco e nenhuma chamada de producao ocorreu, em todas as tentativas', async () => {
    for (const text of [
      `/nfse ${ARGS}`,
      '/nfse_confirmar 1 ABCDEFGH',
      '/nfse_confirmar 2 ZZZZZZZZ',
    ]) {
      await execute(text);
    }
    const repository = app.get<Repository<NfseEmission>>(getRepositoryToken(NfseEmission), {
      strict: false,
    });

    expect(await repository.count()).toBe(0);
    expect(httpsRequest).not.toHaveBeenCalled();
  });
});
