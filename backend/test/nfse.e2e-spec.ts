import {
  FAKE_SEFIN_PORT,
  NFSE_PRESTADOR_CNPJ,
  NFSE_TEST_CERTIFICATE_PEM,
} from './support/nfse-env';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CommandResultResponseDto } from '../src/modules/commands/dto/command-result-response.dto';
import { verifyDpsSignature } from '../src/modules/integrations/nfse/nfse-signer';
import { validateDpsXml } from '../src/modules/integrations/nfse/nfse-xsd.validator';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const TOMADOR_CPF = '52998224725';
const TOMADOR_NOME = 'Maria Tomadora Sigilosa';
const ARGS = `tomador=${TOMADOR_CPF} nome="${TOMADOR_NOME}" valor=1500,50 servico=010101 desc="Servico ficticio de teste" iss=1 ret=1 local=3106200 totsn=12,5`;

interface SefinCall {
  method: string;
  url: string;
  body: string;
}

/**
 * NFS-e na aplicacao COMPLETA: motor de comandos, RBAC, banco, assinatura REAL com certificado
 * ficticio, esquema oficial e uma Sefin FALSA. Nenhuma emissao real, nenhum certificado real.
 */
describe('NFS-e (e2e)', () => {
  let app: INestApplication;
  let sefin: Server;
  let adminJwt: string;
  let operadorJwt: string;
  const calls: SefinCall[] = [];
  let sefinAnswer: (call: SefinCall, response: ServerResponse) => void;

  const server = (): http.Server => app.getHttpServer() as http.Server;

  async function login(email: string, senha: string): Promise<string> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return (response.body as AuthResponseDto).accessToken;
  }

  async function execute(token: string, text: string): Promise<CommandResultResponseDto> {
    const response = await request(server())
      .post('/commands/execute')
      .set('Authorization', `Bearer ${token}`)
      .send({ text })
      .expect(200);
    return response.body as CommandResultResponseDto;
  }

  let adminSeq = 0;
  /** Cada teste usa a sua propria pessoa: o limite de 5 pedidos/min vale POR PESSOA (e e testado a parte). */
  async function freshAdmin(): Promise<string> {
    const email = `admin${String(++adminSeq)}@nfse.test`;
    await app.get(UsersService, { strict: false }).create({
      nome: `Admin ${String(adminSeq)}`,
      email,
      senha: 'Senha1234',
      role: RoleName.Admin,
    });
    return login(email, 'Senha1234');
  }

  /** Chave de acesso FALSA e unica por DPS (50 digitos), derivada do identificador da DPS. */
  const chaveOf = (dpsId: string): string => dpsId.replace(/^DPS/, '').padEnd(50, '7');
  const dpsIdIn = (xml: string): string => /Id="(DPS\d{42})"/.exec(xml)?.[1] ?? '';
  const nfseBody = (chave: string, inner = ''): string =>
    JSON.stringify({
      chaveAcesso: chave,
      nfseXmlGZipB64: gzipSync(
        Buffer.from(
          `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${chave}"></infNFSe>${inner}</NFSe>`,
        ),
      ).toString('base64'),
    });

  const authorized = (call: SefinCall, response: ServerResponse): void => {
    const sent = JSON.parse(call.body) as { dpsXmlGZipB64: string };
    const dps = gunzipSync(Buffer.from(sent.dpsXmlGZipB64, 'base64')).toString('utf8');
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(nfseBody(chaveOf(dpsIdIn(dps)), dps));
  };

  beforeAll(async () => {
    sefin = http.createServer((request_: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request_.on('data', (chunk: Buffer) => chunks.push(chunk));
      request_.on('end', () => {
        const call = {
          method: request_.method ?? '',
          url: request_.url ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
        };
        calls.push(call);
        sefinAnswer(call, response);
      });
    });
    await new Promise<void>((resolve) => sefin.listen(FAKE_SEFIN_PORT, '127.0.0.1', resolve));

    app = await createTestApp();
    adminJwt = await login(ADMIN.email, ADMIN.senha);
    await app.get(UsersService, { strict: false }).create({
      nome: 'Operador Teste',
      email: 'operador@nfse.test',
      senha: 'Senha1234',
      role: RoleName.Operador,
    });
    operadorJwt = await login('operador@nfse.test', 'Senha1234');
  });

  afterAll(async () => {
    await app.close();
    sefin.closeAllConnections();
    await new Promise<void>((resolve) => sefin.close(() => resolve()));
  });

  beforeEach(() => {
    calls.length = 0;
    sefinAnswer = authorized;
  });

  it('os tres comandos aparecem em /ajuda', async () => {
    const help = await execute(adminJwt, '/ajuda');
    for (const name of ['/nfse', '/nfse_confirmar', '/nfse_status']) {
      expect(help.reply).toContain(name);
    }
  });

  it('o OPERADOR nao emite, nao confirma e nao consulta: nenhuma permissao por padrao', async () => {
    for (const text of ['/nfse', `/nfse ${ARGS}`, '/nfse_confirmar 1 ABCDEFGH', '/nfse_status']) {
      const result = await execute(operadorJwt, text);
      expect(result).toMatchObject({ success: false, outcome: 'PERMISSION_DENIED' });
    }
    expect(calls).toHaveLength(0);
  });

  it('fluxo completo: pedido, resumo, confirmacao vinculada, assinatura valida, envio unico, entrega', async () => {
    const jwt = await freshAdmin();
    const created = await execute(jwt, `/nfse ${ARGS}`);
    expect(created.success).toBe(true);
    expect(created.reply).toContain('PRODUCAO');
    expect(created.reply).toContain('R$ 1.500,50');
    expect(created.reply).not.toContain(TOMADOR_CPF);
    const match = /\/nfse_confirmar (\d+) ([A-Z2-9]{8})/.exec(created.reply);
    expect(match).not.toBeNull();
    const [, numero = '', code = ''] = match ?? [];
    // O pedido NAO emite nada.
    expect(calls).toHaveLength(0);

    const status = await execute(jwt, `/nfse_status ${numero}`);
    expect(status.reply).toMatch(/aguardando a sua confirmacao \(nada foi emitido\)/);

    const done = await execute(jwt, `/nfse_confirmar ${numero} ${code}`);
    expect(done.success).toBe(true);
    expect(done.reply).toContain('EMITIDA');
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]?.body ?? '{}') as { dpsXmlGZipB64: string };
    const dps = gunzipSync(Buffer.from(sent.dpsXmlGZipB64, 'base64')).toString('utf8');
    expect(done.reply).toContain(chaveOf(dpsIdIn(dps)));
    expect((await validateDpsXml(dps, 'producao-2026-02')).errors).toEqual([]);
    expect(verifyDpsSignature(dps, NFSE_TEST_CERTIFICATE_PEM)).toBe(true);
    expect(dps).toContain(`<CNPJ>${NFSE_PRESTADOR_CNPJ}</CNPJ>`);
    expect(dps).toContain('<tpAmb>1</tpAmb>');

    // Repetir a confirmacao (update duplicado, usuario insistindo) nao envia de novo.
    const again = await execute(jwt, `/nfse_confirmar ${numero} ${code}`);
    expect(again.success).toBe(false);
    expect(again.reply).toMatch(/Nao vou enviar de novo/);
    expect(calls).toHaveLength(1);

    const listed = await execute(jwt, '/nfse_status');
    expect(listed.reply).toContain('EMITIDA');
  });

  it('duas confirmacoes simultaneas do mesmo pedido: a Sefin recebe UMA so', async () => {
    const jwt = await freshAdmin();
    const created = await execute(jwt, `/nfse ${ARGS}`);
    const [, numero = '', code = ''] =
      /\/nfse_confirmar (\d+) ([A-Z2-9]{8})/.exec(created.reply) ?? [];
    const results = await Promise.all([
      execute(jwt, `/nfse_confirmar ${numero} ${code}`),
      execute(jwt, `/nfse_confirmar ${numero} ${code}`),
      execute(jwt, `/nfse_confirmar ${numero} ${code}`),
    ]);
    expect(results.filter((result) => result.reply.includes('EMITIDA'))).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('um "sim", um codigo errado ou o numero de outro pedido nao emitem nada', async () => {
    const jwt = await freshAdmin();
    await execute(jwt, `/nfse ${ARGS}`);
    const created = await execute(jwt, `/nfse ${ARGS}`);
    const [, numero = ''] = /\/nfse_confirmar (\d+) ([A-Z2-9]{8})/.exec(created.reply) ?? [];
    for (const text of [
      'sim',
      '/nfse_confirmar sim',
      `/nfse_confirmar ${numero} ZZZZZZZZ`,
      `/nfse_confirmar ${String(Number(numero) + 50)} ZZZZZZZZ`,
    ]) {
      const result = await execute(jwt, text);
      expect(result.success).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it('entrada fiscal invalida: nada e criado e a mensagem nao repete o dado', async () => {
    const jwt = await freshAdmin();
    const result = await execute(
      jwt,
      '/nfse tomador=12345678900 nome=A valor=99999999 servico=1 iss=2',
    );
    expect(result.success).toBe(false);
    expect(result.reply).toMatch(/falta o campo|invalido|acima do limite/);
    expect(result.reply).not.toContain('12345678900');
    expect(calls).toHaveLength(0);
  });

  it('Sefin com erro 500: resultado INCERTO, e consultar varias vezes NAO reenvia a DPS', async () => {
    const jwt = await freshAdmin();
    sefinAnswer = (_call, response) => {
      response.writeHead(500);
      response.end('erro interno');
    };
    const created = await execute(jwt, `/nfse ${ARGS}`);
    const [, numero = '', code = ''] =
      /\/nfse_confirmar (\d+) ([A-Z2-9]{8})/.exec(created.reply) ?? [];
    const done = await execute(jwt, `/nfse_confirmar ${numero} ${code}`);
    expect(done.success).toBe(false);
    expect(done.reply).toMatch(/RESULTADO INCERTO/);
    expect(done.reply).toMatch(/NAO crie outro pedido igual/);

    sefinAnswer = (_call, response) => {
      response.writeHead(404);
      response.end('');
    };
    for (let i = 0; i < 3; i += 1) {
      expect((await execute(jwt, `/nfse_status ${numero}`)).reply).toMatch(/RESULTADO INCERTO/);
    }
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls.slice(1).every((call) => call.method === 'GET')).toBe(true);

    // A Sefin passa a reconhecer a DPS: a consulta reconcilia, sem emitir.
    sefinAnswer = (call, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      const dpsId = /\/dps\/(DPS\d{42})/.exec(call.url)?.[1];
      response.end(
        dpsId === undefined
          ? nfseBody(/\/nfse\/(\d{50})/.exec(call.url)?.[1] ?? '')
          : JSON.stringify({ chaveAcesso: chaveOf(dpsId) }),
      );
    };
    const reconciled = await execute(jwt, `/nfse_status ${numero}`);
    expect(reconciled.reply).toContain('EMITIDA');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('rejeicao da Sefin: mostra o codigo oficial e nada fica como emitido', async () => {
    const jwt = await freshAdmin();
    sefinAnswer = (_call, response) => {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          erro: [{ codigo: 'E0310', descricao: 'Codigo de tributacao inexistente' }],
        }),
      );
    };
    const created = await execute(jwt, `/nfse ${ARGS}`);
    const [, numero = '', code = ''] =
      /\/nfse_confirmar (\d+) ([A-Z2-9]{8})/.exec(created.reply) ?? [];
    const done = await execute(jwt, `/nfse_confirmar ${numero} ${code}`);
    expect(done.success).toBe(false);
    expect(done.reply).toContain('E0310');
    expect(done.reply).toMatch(/nada foi emitido/);
  });

  it('a trilha de auditoria registra quem e o que aconteceu, sem dado fiscal, codigo, chave ou certificado', async () => {
    const response = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    const items = (response.body as AuditLogPageResponseDto).items.filter(
      (item) => item.modulo === 'NFSE',
    );
    expect(items.length).toBeGreaterThan(5);
    expect(new Set(items.map((item) => item.acao))).toEqual(
      new Set(['NFSE_COMMAND', 'NFSE_STATE_CHANGED']),
    );
    const text = JSON.stringify(items);
    for (const secret of [
      TOMADOR_CPF,
      TOMADOR_NOME,
      'Servico ficticio',
      '1500',
      'senha-de-teste-ficticia',
      'BEGIN',
    ]) {
      expect(text).not.toContain(secret);
    }
    // Nenhuma chave de acesso (50 digitos seguidos) na trilha.
    expect(text).not.toMatch(/\d{50}/);
  });
});
