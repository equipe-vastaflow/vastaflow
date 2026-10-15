import { gunzipSync, gzipSync } from 'node:zlib';
import { DataSource } from 'typeorm';
import { createTestPki, type TestPki } from '../../../../test/support/nfse-test-pki';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import { NfseTransportError, type NfseTransport } from './nfse-api.client';
import { NfseCertificateError, openPfx, type NfseCertificate } from './nfse-certificate';
import { NfseEmission, NfseEmissionStatus } from './nfse-emission.entity';
import { NfseEmissionsRepository } from './nfse-emissions.repository';
import { verifyDpsSignature } from './nfse-signer';
import { NfseService, STALE_SENDING_MS, type AuditWriter } from './nfse.service';

const USER = 'user-1';
const OTHER = 'user-2';
const CHAVE = '31062002211222333000181000000000000726101234567890'.slice(0, 50);
const nfseXml = (chave: string): string =>
  `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${chave}"></infNFSe></NFSe>`;
const authorizedBody = (chave = CHAVE): string =>
  JSON.stringify({
    chaveAcesso: chave,
    nfseXmlGZipB64: gzipSync(Buffer.from(nfseXml(chave))).toString('base64'),
  });

const CONFIG = {
  NFSE_ENABLED: true,
  NFSE_AMBIENTE: 'restrita',
  // Servidor de teste: o transporte e injetado, nada sai pela rede.
  NFSE_API_BASE_URL: 'http://nfse-fake:9',
  NFSE_CERT_PFX_PATH: '/run/secrets/ficticio.pfx',
  NFSE_CERT_PFX_PASSWORD: 'senha-ficticia',
  NFSE_PRESTADOR_CNPJ: '11222333000181',
  NFSE_PRESTADOR_IM: '123456',
  NFSE_PRESTADOR_NOME: 'Empresa Ficticia Ltda',
  NFSE_MUNICIPIO_EMISSOR_IBGE: '3106200',
  NFSE_OPCAO_SIMPLES: '3',
  NFSE_REGIME_APURACAO_SN: '1',
  NFSE_REGIME_ESPECIAL_TRIBUTACAO: '0',
  NFSE_DPS_SERIE: '1',
  NFSE_VALOR_MAXIMO: '5000',
} as Record<string, unknown>;

const ARGS =
  'tomador=52998224725 nome="Maria Teste Sigilosa" valor=1500,50 servico=010101 desc="Consultoria ficticia" iss=1 ret=1 local=3106200 totsn=12,5';

interface Call {
  method: string;
  url: string;
  body?: string;
}

class Harness {
  readonly calls: Call[] = [];
  readonly audit: Array<Record<string, unknown>> = [];
  respond: (call: Call) => Promise<{ status: number; body: string }> = () =>
    Promise.resolve({ status: 201, body: authorizedBody() });
  config: Record<string, unknown> = { ...CONFIG };
  clock = new Date('2026-10-15T15:00:00Z');
  certificate: NfseCertificate;
  certificateFails = false;
  codeSeq = 0;
  readonly service: NfseService;
  readonly emissions: NfseEmissionsRepository;

  constructor(
    readonly dataSource: DataSource,
    pki: TestPki,
    inlineWaitMs = 5000,
  ) {
    this.certificate = openPfx(pki.pfx, pki.password, this.clock);
    this.emissions = new NfseEmissionsRepository(dataSource.getRepository(NfseEmission));
    const audit: AuditWriter = {
      record: (event) => {
        this.audit.push(event);
        return Promise.resolve();
      },
    };
    const transport: NfseTransport = async (request) => {
      const call: Call = {
        method: request.method,
        url: request.url.toString(),
        body: request.body,
      };
      this.calls.push(call);
      return this.respond(call);
    };
    this.service = new NfseService(
      { get: <T>(key: string): T | undefined => this.config[key] as T | undefined },
      this.emissions,
      audit,
      {
        now: () => this.clock,
        randomCode: () =>
          `K7M2Q${String(++this.codeSeq).padStart(3, '0')}`.replace(/0/g, 'X').replace(/1/g, 'Y'),
        transport: () => transport,
        loadCertificate: () => {
          if (this.certificateFails) {
            throw new NfseCertificateError('arquivo_ilegivel');
          }
          return this.certificate;
        },
        inlineWaitMs,
      },
    );
  }

  posts(): Call[] {
    return this.calls.filter((call) => call.method === 'POST');
  }

  /** Cria um pedido e devolve numero e codigo. */
  async createRequest(
    user = USER,
    canal = 'telegram',
    args = ARGS,
  ): Promise<{ numero: number; code: string }> {
    const result = await this.service.request(user, canal, args);
    if (result.kind !== 'created') {
      throw new Error(`pedido nao criado: ${JSON.stringify(result)}`);
    }
    return { numero: result.numero, code: result.code };
  }

  row(numero: number): Promise<NfseEmission | null> {
    return this.dataSource.getRepository(NfseEmission).findOne({ where: { numeroDps: numero } });
  }
}

describe('NFS-e - servico (maquina de estados, idempotencia, incerteza)', () => {
  let pki: TestPki;
  let dataSource: DataSource;
  let h: Harness;

  beforeAll(() => {
    pki = createTestPki({});
  });

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'sqljs', entities: [NfseEmission], synchronize: true });
    await dataSource.initialize();
    h = new Harness(dataSource, pki);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  describe('pedido', () => {
    it('desligada: nada e criado; ligada incompleta: recusa sem dizer o que falta', async () => {
      h.config = { ...CONFIG, NFSE_ENABLED: false };
      expect(await h.service.request(USER, 'telegram', ARGS)).toEqual({ kind: 'disabled' });
      h.config = { ...CONFIG, NFSE_DPS_SERIE: undefined };
      expect(await h.service.request(USER, 'telegram', ARGS)).toEqual({ kind: 'misconfigured' });
      expect(await dataSource.getRepository(NfseEmission).count()).toBe(0);
    });

    it('cria o pedido AGUARDANDO_CONFIRMACAO sem transmitir nada; grava so o HASH do codigo', async () => {
      const result = await h.service.request(USER, 'telegram', ARGS);
      expect(result.kind).toBe('created');
      if (result.kind !== 'created') {
        return;
      }
      expect(result.numero).toBe(1);
      expect(result.expiresInMinutes).toBe(10);
      expect(result.summary).toContain('HOMOLOGACAO');
      expect(result.summary).toContain('R$ 1.500,50');
      expect(result.summary).not.toContain('52998224725');
      const row = await h.row(1);
      expect(row?.status).toBe(NfseEmissionStatus.AguardandoConfirmacao);
      expect(row?.confirmHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(result.code);
      expect(row?.dpsId).toBe('DPS310620021122233300018100001000000000000001');
      expect(h.calls).toHaveLength(0);
    });

    it('entrada invalida nao cria nada e lista os problemas', async () => {
      const result = await h.service.request(USER, 'telegram', 'tomador=1 valor=x');
      expect(result.kind).toBe('invalid');
      expect(await dataSource.getRepository(NfseEmission).count()).toBe(0);
    });

    it('um pedido novo CANCELA o anterior ainda nao confirmado (so existe um codigo valido por pessoa)', async () => {
      const first = await h.createRequest();
      const second = await h.createRequest();
      expect(second.numero).toBe(first.numero + 1);
      expect((await h.row(first.numero))?.status).toBe(NfseEmissionStatus.Expirada);
      expect(
        await h.service.confirm(USER, 'telegram', String(first.numero), first.code),
      ).toMatchObject({
        kind: 'already_used',
      });
      expect(h.calls).toHaveLength(0);
    });

    it('pedidos simultaneos recebem numeros de DPS distintos (indice unico)', async () => {
      const results = await Promise.all(
        [USER, OTHER, 'user-3', 'user-4'].map((user) => h.service.request(user, 'telegram', ARGS)),
      );
      const numbers = results.map((result) => (result.kind === 'created' ? result.numero : -1));
      expect(new Set(numbers).size).toBe(4);
      expect(numbers.every((number) => number > 0)).toBe(true);
    });

    it('limita pedidos por pessoa (5/min)', async () => {
      for (let i = 0; i < 5; i += 1) {
        expect((await h.service.request(USER, 'telegram', ARGS)).kind).toBe('created');
      }
      expect((await h.service.request(USER, 'telegram', ARGS)).kind).toBe('invalid');
    });
  });

  describe('confirmacao e transmissao', () => {
    it('caminho feliz: assina, valida, envia UMA vez e guarda a NFS-e autorizada', async () => {
      const { numero, code } = await h.createRequest();
      const result = await h.service.confirm(USER, 'telegram', String(numero), code);
      expect(result).toMatchObject({
        kind: 'finished',
        emission: {
          numero: 1,
          status: NfseEmissionStatus.Autorizada,
          chaveAcesso: CHAVE,
          ambiente: 'homologacao',
        },
      });
      expect(h.posts()).toHaveLength(1);
      expect(h.calls[0]?.url).toBe('http://nfse-fake:9/nfse');
      const sent = JSON.parse(h.calls[0]?.body ?? '{}') as { dpsXmlGZipB64: string };
      const xml = gunzipSync(Buffer.from(sent.dpsXmlGZipB64, 'base64')).toString('utf8');
      expect(xml).toContain('Id="DPS310620021122233300018100001000000000000001"');
      expect(xml).toContain('<Signature');
      expect(verifyDpsSignature(xml, h.certificate.certificatePem)).toBe(true);
      const row = await h.row(1);
      expect(row).toMatchObject({
        status: NfseEmissionStatus.Autorizada,
        chaveAcesso: CHAVE,
        confirmHash: null,
        tentativas: 1,
      });
      expect(row?.nfseXml).toBe(nfseXml(CHAVE));
    });

    it('a mesma confirmacao repetida NAO transmite de novo', async () => {
      const { numero, code } = await h.createRequest();
      await h.service.confirm(USER, 'telegram', String(numero), code);
      for (let i = 0; i < 3; i += 1) {
        expect(await h.service.confirm(USER, 'telegram', String(numero), code)).toMatchObject({
          kind: 'already_used',
        });
      }
      expect(h.posts()).toHaveLength(1);
    });

    it('confirmacoes SIMULTANEAS (update duplicado, dois dispositivos): so uma transmite', async () => {
      const { numero, code } = await h.createRequest();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => h.service.confirm(USER, 'telegram', String(numero), code)),
      );
      expect(results.filter((result) => result.kind === 'finished')).toHaveLength(1);
      expect(results.filter((result) => result.kind === 'already_used')).toHaveLength(4);
      expect(h.posts()).toHaveLength(1);
    });

    it('a confirmacao so vale no canal e para a pessoa do pedido (Telegram x WhatsApp)', async () => {
      const { numero, code } = await h.createRequest(USER, 'telegram');
      expect(await h.service.confirm(USER, 'whatsapp', String(numero), code)).toEqual({
        kind: 'not_found',
      });
      expect(await h.service.confirm(OTHER, 'telegram', String(numero), code)).toEqual({
        kind: 'not_found',
      });
      expect(h.calls).toHaveLength(0);
      expect((await h.row(numero))?.status).toBe(NfseEmissionStatus.AguardandoConfirmacao);
      // E o dono, no canal certo, ainda consegue.
      expect((await h.service.confirm(USER, 'telegram', String(numero), code)).kind).toBe(
        'finished',
      );
    });

    it('codigo errado, de outro pedido ou "sim" solto nao emitem nada', async () => {
      const a = await h.createRequest();
      expect(await h.service.confirm(USER, 'telegram', String(a.numero), 'ZZZZZZZZ')).toEqual({
        kind: 'not_found',
      });
      expect(await h.service.confirm(USER, 'telegram', '999', a.code)).toEqual({
        kind: 'not_found',
      });
      expect(await h.service.confirm(USER, 'telegram', String(a.numero), 'sim')).toEqual({
        kind: 'bad_format',
      });
      expect(await h.service.confirm(USER, 'telegram', 'sim', a.code)).toEqual({
        kind: 'bad_format',
      });
      expect(h.calls).toHaveLength(0);
    });

    it('o codigo de um pedido NAO confirma outro pedido da mesma pessoa', async () => {
      const first = await h.createRequest();
      const second = await h.createRequest();
      expect(await h.service.confirm(USER, 'telegram', String(second.numero), first.code)).toEqual({
        kind: 'not_found',
      });
      expect(h.calls).toHaveLength(0);
    });

    it('adivinhar o codigo e barrado: apos 8 tentativas, throttled', async () => {
      const { numero, code } = await h.createRequest();
      for (let i = 0; i < 8; i += 1) {
        expect((await h.service.confirm(USER, 'telegram', String(numero), 'ZZZZZZZZ')).kind).toBe(
          'not_found',
        );
      }
      expect(await h.service.confirm(USER, 'telegram', String(numero), code)).toEqual({
        kind: 'throttled',
      });
      expect(h.calls).toHaveLength(0);
    });

    it('codigo vencido: expira, nada e emitido e o codigo nao revive', async () => {
      const { numero, code } = await h.createRequest();
      h.clock = new Date(h.clock.getTime() + 11 * 60_000);
      expect(await h.service.confirm(USER, 'telegram', String(numero), code)).toEqual({
        kind: 'expired',
      });
      expect((await h.row(numero))?.status).toBe(NfseEmissionStatus.Expirada);
      h.clock = new Date(h.clock.getTime() - 5 * 60_000);
      expect((await h.service.confirm(USER, 'telegram', String(numero), code)).kind).toBe(
        'already_used',
      );
      expect(h.calls).toHaveLength(0);
    });

    it('dados alterados no banco depois do pedido: o resumo nao confere e NADA e emitido', async () => {
      const { numero, code } = await h.createRequest();
      const row = await h.row(numero);
      await dataSource
        .getRepository(NfseEmission)
        .update({ id: row?.id }, { dados: { ...row?.dados, valor: '9500.50' } });
      expect(await h.service.confirm(USER, 'telegram', String(numero), code)).toEqual({
        kind: 'not_found',
      });
      expect(h.calls).toHaveLength(0);
    });

    it('configuracao alterada depois do pedido (outro CNPJ/serie/municipio): nao emite', async () => {
      const { numero, code } = await h.createRequest();
      h.config = { ...h.config, NFSE_MUNICIPIO_EMISSOR_IBGE: '3550308' };
      const result = await h.service.confirm(USER, 'telegram', String(numero), code);
      expect(result).toMatchObject({
        kind: 'finished',
        emission: { status: NfseEmissionStatus.NaoEnviada, erroCodigo: 'configuracao_alterada' },
      });
      expect(h.calls).toHaveLength(0);
    });
  });

  describe('resultados e falhas', () => {
    it('rejeicao da Sefin: REJEITADA com o codigo oficial, sem reenvio', async () => {
      h.respond = () =>
        Promise.resolve({
          status: 400,
          body: JSON.stringify({
            erro: [{ codigo: 'E0310', descricao: 'Codigo de tributacao inexistente' }],
          }),
        });
      const { numero, code } = await h.createRequest();
      const result = await h.service.confirm(USER, 'telegram', String(numero), code);
      expect(result).toMatchObject({
        kind: 'finished',
        emission: { status: NfseEmissionStatus.Rejeitada, erroCodigo: 'E0310', chaveAcesso: null },
      });
      expect(h.posts()).toHaveLength(1);
      expect((await h.row(numero))?.nfseXml).toBeNull();
    });

    it('queda de conexao DEPOIS do envio: INCERTA, e consultar o estado NAO reenvia', async () => {
      h.respond = () => Promise.reject(new NfseTransportError(true));
      const { numero, code } = await h.createRequest();
      const result = await h.service.confirm(USER, 'telegram', String(numero), code);
      expect(result).toMatchObject({
        kind: 'finished',
        emission: { status: NfseEmissionStatus.Incerta },
      });
      expect(h.posts()).toHaveLength(1);

      // A Sefin ainda nao conhece a DPS: continua incerta, e SO houve consultas (GET).
      h.respond = () => Promise.resolve({ status: 404, body: '' });
      for (let i = 0; i < 3; i += 1) {
        const status = await h.service.status(USER, String(numero));
        expect(status).toMatchObject({
          kind: 'list',
          items: [{ status: NfseEmissionStatus.Incerta }],
        });
      }
      expect(h.posts()).toHaveLength(1);
      expect(h.calls.slice(1).every((call) => call.method === 'GET')).toBe(true);
    });

    it('resposta 500 e corpo ilegivel tambem sao INCERTA (nunca "nao emitida")', async () => {
      for (const respond of [
        () => Promise.resolve({ status: 500, body: 'boom' }),
        () => Promise.resolve({ status: 201, body: 'lixo' }),
        () => Promise.resolve({ status: 504, body: '' }),
      ]) {
        h.respond = respond;
        const { numero, code } = await h.createRequest();
        const result = await h.service.confirm(USER, 'telegram', String(numero), code);
        expect(result).toMatchObject({
          kind: 'finished',
          emission: { status: NfseEmissionStatus.Incerta },
        });
      }
      expect(h.posts()).toHaveLength(3);
    });

    it('reconciliacao: a Sefin confirma por consulta que a DPS gerou NFS-e -> AUTORIZADA, sem reenviar', async () => {
      h.respond = () => Promise.reject(new NfseTransportError(true));
      const { numero, code } = await h.createRequest();
      await h.service.confirm(USER, 'telegram', String(numero), code);

      h.respond = (call) =>
        Promise.resolve(
          call.url.includes('/dps/')
            ? { status: 200, body: JSON.stringify({ chaveAcesso: CHAVE }) }
            : { status: 200, body: authorizedBody() },
        );
      const status = await h.service.status(USER, String(numero));
      expect(status).toMatchObject({
        kind: 'list',
        items: [{ status: NfseEmissionStatus.Autorizada, chaveAcesso: CHAVE }],
      });
      expect(h.posts()).toHaveLength(1);
      expect((await h.row(numero))?.nfseXml).toBe(nfseXml(CHAVE));
      expect(
        h.calls.filter((call) =>
          call.url.includes('/dps/DPS310620021122233300018100001000000000000001'),
        ),
      ).toHaveLength(1);
    });

    it('sem conexao (nunca chegou): NAO_ENVIADA; certificado ausente ou de outro CNPJ: nada sai', async () => {
      h.respond = () => Promise.reject(new NfseTransportError(false));
      let r = await h.createRequest();
      expect(await h.service.confirm(USER, 'telegram', String(r.numero), r.code)).toMatchObject({
        emission: { status: NfseEmissionStatus.NaoEnviada, erroCodigo: 'sem_conexao' },
      });

      h.calls.length = 0;
      // Servico novo: o certificado aberto fica em cache dentro de cada instancia.
      h = new Harness(dataSource, pki);
      h.certificateFails = true;
      r = await h.createRequest();
      expect(await h.service.confirm(USER, 'telegram', String(r.numero), r.code)).toMatchObject({
        emission: { status: NfseEmissionStatus.NaoEnviada, erroCodigo: 'certificado_indisponivel' },
      });
      h = new Harness(dataSource, pki);

      h.certificate = openPfx(
        createTestPki({ cnpj: '99888777000166' }).pfx,
        'senha-de-teste-ficticia',
        h.clock,
      );
      r = await h.createRequest();
      expect(await h.service.confirm(USER, 'telegram', String(r.numero), r.code)).toMatchObject({
        emission: {
          status: NfseEmissionStatus.NaoEnviada,
          erroCodigo: 'certificado_diverge_do_prestador',
        },
      });
      expect(h.calls).toHaveLength(0);
    });

    it('certificado SEM a extensao de CNPJ tambem nao assina (falha fechada)', async () => {
      h.certificate = openPfx(
        createTestPki({ cnpj: null }).pfx,
        'senha-de-teste-ficticia',
        h.clock,
      );
      const { numero, code } = await h.createRequest();
      expect(await h.service.confirm(USER, 'telegram', String(numero), code)).toMatchObject({
        emission: {
          status: NfseEmissionStatus.NaoEnviada,
          erroCodigo: 'certificado_diverge_do_prestador',
        },
      });
      expect(h.calls).toHaveLength(0);
    });

    it('Sefin real sem o contrato de troca confirmado: NAO_ENVIADA, nenhuma chamada', async () => {
      h.config = { ...CONFIG, NFSE_API_BASE_URL: undefined, NFSE_WIRE_CONTRACT_CONFIRMED: false };
      const { numero, code } = await h.createRequest();
      expect(await h.service.confirm(USER, 'telegram', String(numero), code)).toMatchObject({
        emission: { status: NfseEmissionStatus.NaoEnviada, erroCodigo: 'contrato_nao_confirmado' },
      });
      expect(h.calls).toHaveLength(0);
    });

    it('banco fora do ar ao gravar o resultado: o chat recebe "incerta", sem rejeicao nao tratada', async () => {
      const { numero, code } = await h.createRequest();
      jest.spyOn(h.emissions, 'transition').mockRejectedValue(new Error('banco indisponivel'));
      const result = await h.service.confirm(USER, 'telegram', String(numero), code);
      expect(result).toMatchObject({
        kind: 'finished',
        emission: { status: NfseEmissionStatus.Incerta, erroCodigo: 'falha_interna' },
      });
      expect(h.posts()).toHaveLength(1);
    });

    it('Sefin lenta: o chat recebe "em processamento", a transmissao termina sozinha e nao se repete', async () => {
      const slow = new Harness(dataSource, pki, 30);
      slow.respond = async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { status: 201, body: authorizedBody() };
      };
      const { numero, code } = await slow.createRequest();
      const first = await slow.service.confirm(USER, 'telegram', String(numero), code);
      expect(first).toEqual({ kind: 'processing', numero });
      // Reenviar o comando enquanto processa nao envia de novo.
      expect((await slow.service.confirm(USER, 'telegram', String(numero), code)).kind).toBe(
        'already_used',
      );
      for (
        let i = 0;
        i < 50 && (await slow.row(numero))?.status === NfseEmissionStatus.Enviando;
        i += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect((await slow.row(numero))?.status).toBe(NfseEmissionStatus.Autorizada);
      expect(slow.posts()).toHaveLength(1);
    });

    it('ENVIANDO esquecido (o processo caiu) vira INCERTA na consulta, nunca e reenviado', async () => {
      const { numero } = await h.createRequest();
      const row = await h.row(numero);
      await dataSource.getRepository(NfseEmission).update(
        { id: row?.id },
        {
          status: NfseEmissionStatus.Enviando,
          ultimaTentativaEm: new Date(h.clock.getTime() - STALE_SENDING_MS - 1000),
        },
      );
      h.respond = () => Promise.resolve({ status: 404, body: '' });
      expect(await h.service.status(USER, String(numero))).toMatchObject({
        items: [{ status: NfseEmissionStatus.Incerta }],
      });
      expect(h.posts()).toHaveLength(0);
    });
  });

  describe('consulta', () => {
    it('lista so os pedidos da propria pessoa e valida o numero', async () => {
      await h.createRequest(USER, 'telegram');
      await h.createRequest(OTHER, 'whatsapp');
      const mine = await h.service.status(USER, undefined);
      expect(mine).toMatchObject({ kind: 'list' });
      expect(mine.kind === 'list' ? mine.items.map((item) => item.numero) : []).toEqual([1]);
      expect(await h.service.status(USER, '2')).toEqual({ kind: 'list', items: [] });
      expect(await h.service.status(USER, 'abc')).toEqual({ kind: 'bad_format' });
      expect(await h.service.status(USER, '0')).toEqual({ kind: 'bad_format' });
    });
  });

  describe('auditoria', () => {
    it('registra as mudancas de estado SEM dado fiscal, tomador, valor, codigo ou chave', async () => {
      const { numero, code } = await h.createRequest();
      await h.service.confirm(USER, 'telegram', String(numero), code);
      expect(h.audit.length).toBeGreaterThanOrEqual(2);
      for (const event of h.audit) {
        expect(event.acao).toBe(AuditAction.NfseStateChanged);
        expect(event.modulo).toBe(AuditModuleName.Nfse);
        expect(event.usuarioId).toBe(USER);
      }
      const serialized = JSON.stringify(h.audit);
      for (const secret of [
        '52998224725',
        'Maria Teste Sigilosa',
        '1500',
        code,
        CHAVE,
        'Consultoria',
        'senha-ficticia',
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(h.audit.map((event) => (event.metadados as { para: string }).para)).toEqual([
        NfseEmissionStatus.Enviando,
        NfseEmissionStatus.Autorizada,
      ]);
    });
  });
});
