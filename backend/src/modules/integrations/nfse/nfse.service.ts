import { randomInt, timingSafeEqual } from 'node:crypto';
import { SlidingWindowLimiter } from '../../../common/rate-limit/sliding-window-limiter';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import {
  NfseApiClient,
  NfseContractUnconfirmedError,
  createTransport,
  type NfseTransport,
} from './nfse-api.client';
import { loadNfseCertificate, type NfseCertificate } from './nfse-certificate';
import {
  buildNfseInput,
  hashText,
  parseNfseArgs,
  summarizeInput,
  type NfseEmissionInput,
} from './nfse-dps';
import { NfseEmission, NfseEmissionStatus } from './nfse-emission.entity';
import type { NfseEmissionsRepository } from './nfse-emissions.repository';
import { resolveNfseSettings, type NfseEnv, type NfseSettings } from './nfse-settings';
import { signDps } from './nfse-signer';
import { buildDpsXml } from './nfse-xml.builder';
import { validateDpsXml } from './nfse-xsd.validator';

/** Alfabeto do codigo de confirmacao: sem 0/O/1/I/L, para nao haver duvida ao digitar. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CONFIRMATION_CODE_LENGTH = 8;
const CODE_FORMAT = new RegExp(`^[${CODE_ALPHABET}]{${String(CONFIRMATION_CODE_LENGTH)}}$`);

/** Quanto tempo a resposta do chat espera a Sefin antes de dizer "em processamento". */
export const INLINE_WAIT_MS = 12_000;
/** `ENVIANDO` parado alem disto = o processo caiu no meio do envio. */
export const STALE_SENDING_MS = 120_000;

export interface ConfigReader {
  get<T = unknown>(key: string): T | undefined;
}

export interface AuditWriter {
  record(event: {
    usuarioId?: string | null;
    acao: AuditAction;
    modulo: AuditModuleName;
    descricao: string;
    metadados?: Record<string, unknown>;
  }): Promise<void>;
}

type Repo = Pick<
  NfseEmissionsRepository,
  | 'createPending'
  | 'expirePendingOf'
  | 'findOfUser'
  | 'findById'
  | 'listRecent'
  | 'consumeConfirmation'
  | 'expire'
  | 'transition'
  | 'markStaleAsUncertain'
>;

export interface NfseServiceOptions {
  readonly now?: () => Date;
  readonly randomCode?: () => string;
  /** Transporte HTTP (testes injetam um falso; em producao e o mTLS real). */
  readonly transport?: (
    settings: NfseSettings,
    certificate: NfseCertificate | null,
  ) => NfseTransport;
  readonly loadCertificate?: (settings: NfseSettings) => NfseCertificate;
  readonly inlineWaitMs?: number;
}

export type RequestResult =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'misconfigured' }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }
  | { readonly kind: 'internal' }
  | {
      readonly kind: 'created';
      readonly numero: number;
      readonly summary: string;
      readonly code: string;
      readonly expiresInMinutes: number;
    };

export type ConfirmResult =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'misconfigured' }
  | { readonly kind: 'bad_format' }
  | { readonly kind: 'throttled' }
  /** Pedido inexistente, de outra pessoa, de outro canal ou codigo errado: a mesma resposta para todos. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'already_used'; readonly status: NfseEmissionStatus }
  | { readonly kind: 'processing'; readonly numero: number }
  | { readonly kind: 'finished'; readonly emission: EmissionView };

export interface EmissionView {
  readonly numero: number;
  readonly status: NfseEmissionStatus;
  readonly ambiente: 'producao' | 'homologacao';
  readonly chaveAcesso: string | null;
  readonly erroCodigo: string | null;
  readonly erroMensagem: string | null;
}

export type StatusResult =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'misconfigured' }
  | { readonly kind: 'bad_format' }
  | { readonly kind: 'list'; readonly items: readonly EmissionView[] };

/** Espera `promise` por no maximo `ms`; o temporizador e sempre liberado (nao segura o processo). */
async function raceWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout');
    }, ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function view(row: NfseEmission): EmissionView {
  return {
    numero: row.numeroDps,
    status: row.status,
    ambiente: row.ambiente === 1 ? 'producao' : 'homologacao',
    chaveAcesso: row.chaveAcesso,
    erroCodigo: row.erroCodigo,
    erroMensagem: row.erroMensagem,
  };
}

/**
 * Emissao de NFS-e: pedido -> resumo -> confirmacao vinculada -> transmissao -> resultado.
 *
 * Invariantes (cada uma tem teste):
 * - nada e transmitido sem uma confirmacao de uso unico, da MESMA pessoa, no MESMO canal, daquele
 *   pedido especifico e dentro do prazo;
 * - a confirmacao e consumida por um UPDATE condicional: confirmar duas vezes, ou de dois canais ao
 *   mesmo tempo, transmite no maximo uma vez;
 * - resultado incerto (queda depois do envio, resposta ilegivel) NUNCA gera novo envio: o pedido fica
 *   `INCERTA` e so e resolvido por CONSULTA (`GET /dps/{id}`), que nao emite nada;
 * - a mesma DPS tem sempre o mesmo `Id`: mesmo um envio repetido por engano nao geraria segunda nota;
 * - nenhum dado fiscal, codigo, certificado ou senha vai a log ou auditoria.
 */
export class NfseService {
  private readonly now: () => Date;
  private readonly randomCode: () => string;
  private readonly transportFactory: NonNullable<NfseServiceOptions['transport']>;
  private readonly certificateLoader: NonNullable<NfseServiceOptions['loadCertificate']>;
  private readonly inlineWaitMs: number;
  /** Certificado aberto uma vez por processo (ver `docs/nfse.md`: rotacao exige reiniciar o backend). */
  private certificateCache: { readonly key: string; readonly certificate: NfseCertificate } | null =
    null;
  /** Tentativas de confirmar (certas ou erradas) por pessoa: barra a adivinhacao do codigo. */
  private readonly confirmAttempts = new SlidingWindowLimiter(8, 10 * 60_000);
  /** Pedidos de emissao por pessoa: barra o uso do bot como gerador de pedidos. */
  private readonly requestAttempts = new SlidingWindowLimiter(5, 60_000);

  constructor(
    private readonly config: ConfigReader,
    private readonly repository: Repo,
    private readonly audit: AuditWriter,
    options: NfseServiceOptions = {},
  ) {
    this.now = options.now ?? ((): Date => new Date());
    this.randomCode =
      options.randomCode ??
      ((): string =>
        Array.from({ length: CONFIRMATION_CODE_LENGTH }, () =>
          CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length)),
        ).join(''));
    this.transportFactory =
      options.transport ??
      ((settings, certificate): NfseTransport => createTransport(settings, certificate));
    this.certificateLoader =
      options.loadCertificate ??
      ((settings): NfseCertificate =>
        loadNfseCertificate(settings.certPfxPath, settings.certPfxPassword, this.now()));
    this.inlineWaitMs = options.inlineWaitMs ?? INLINE_WAIT_MS;
  }

  /** `disabled` (desligado), `misconfigured` (ligado mas incompleto) ou as configuracoes validas. */
  private settings(): NfseSettings | 'disabled' | 'misconfigured' {
    const enabled = this.config.get<unknown>('NFSE_ENABLED');
    if (enabled !== true && enabled !== 'true') {
      return 'disabled';
    }
    const env: NfseEnv = {};
    for (const key of [
      'NFSE_AMBIENTE',
      'NFSE_API_BASE_URL',
      'NFSE_WIRE_CONTRACT_CONFIRMED',
      'NFSE_CERT_PFX_PATH',
      'NFSE_CERT_PFX_PASSWORD',
      'NFSE_CA_BUNDLE_PATH',
      'NFSE_PRESTADOR_CNPJ',
      'NFSE_PRESTADOR_IM',
      'NFSE_PRESTADOR_NOME',
      'NFSE_MUNICIPIO_EMISSOR_IBGE',
      'NFSE_OPCAO_SIMPLES',
      'NFSE_REGIME_APURACAO_SN',
      'NFSE_REGIME_ESPECIAL_TRIBUTACAO',
      'NFSE_DPS_SERIE',
      'NFSE_VALOR_MAXIMO',
      'NFSE_CONFIRMATION_TTL_MINUTES',
    ] as const) {
      env[key] = this.config.get<unknown>(key);
    }
    const result = resolveNfseSettings(env);
    return result.ok ? result.settings : 'misconfigured';
  }

  // ---------------------------------------------------------------------------------------------
  // 1. Pedido
  // ---------------------------------------------------------------------------------------------

  async request(usuarioId: string, canal: string, rawArgs: string): Promise<RequestResult> {
    const settings = this.settings();
    if (typeof settings === 'string') {
      return { kind: settings };
    }
    const parsed = parseNfseArgs(rawArgs);
    if (!parsed.ok) {
      return { kind: 'invalid', errors: [parsed.error] };
    }
    const built = buildNfseInput(parsed.fields, settings, this.now());
    if (!built.ok) {
      return { kind: 'invalid', errors: built.errors };
    }
    if (!this.requestAttempts.take(usuarioId).allowed) {
      return { kind: 'invalid', errors: ['muitos pedidos em pouco tempo; aguarde um minuto'] };
    }

    const code = this.randomCode();
    const expiresAt = new Date(this.now().getTime() + settings.confirmationTtlMs);
    // Um pedido novo substitui o anterior ainda nao confirmado: so existe UM codigo valido por pessoa.
    await this.repository.expirePendingOf(usuarioId);
    const row = await this.repository.createPending({
      usuarioId,
      canal,
      ambiente: settings.tpAmb,
      serie: settings.serie,
      dados: built.input,
      confirmHash: this.confirmationHash(usuarioId, code),
      confirmExpiresAt: expiresAt,
      identify: (numero) => {
        const dps = buildDpsXml(built.input, settings, numero, this.now());
        return {
          dpsId: dps.dpsId,
          resumoHash: hashText(
            summarizeInput(built.input, { ambiente: settings.ambiente, numero }),
          ),
        };
      },
    });

    // Falha de leiaute e defeito NOSSO: detectada ja no pedido, antes de a pessoa confirmar.
    const dps = buildDpsXml(built.input, settings, row.numeroDps, this.now());
    const xsd = await validateDpsXml(dps.xml);
    if (!xsd.valid) {
      await this.repository.expire(row.id);
      return { kind: 'internal' };
    }

    return {
      kind: 'created',
      numero: row.numeroDps,
      summary: summarizeInput(built.input, { ambiente: settings.ambiente, numero: row.numeroDps }),
      code,
      expiresInMinutes: Math.round(settings.confirmationTtlMs / 60_000),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // 2. Confirmacao (+ transmissao)
  // ---------------------------------------------------------------------------------------------

  async confirm(
    usuarioId: string,
    canal: string,
    rawNumero: string,
    rawCode: string,
  ): Promise<ConfirmResult> {
    const settings = this.settings();
    if (typeof settings === 'string') {
      return { kind: settings };
    }
    const numero = /^\d{1,9}$/.test(rawNumero) ? Number(rawNumero) : null;
    const code = rawCode.toUpperCase().replace(/-/g, '');
    if (numero === null || numero < 1 || !CODE_FORMAT.test(code)) {
      return { kind: 'bad_format' };
    }
    if (!this.confirmAttempts.take(usuarioId).allowed) {
      return { kind: 'throttled' };
    }

    const row = await this.repository.findOfUser(usuarioId, settings.tpAmb, settings.serie, numero);
    // Outro canal, outra pessoa, numero inexistente e codigo errado: a MESMA resposta.
    if (row === null || row.canal !== canal) {
      return { kind: 'not_found' };
    }
    if (row.status !== NfseEmissionStatus.AguardandoConfirmacao) {
      return { kind: 'already_used', status: row.status };
    }
    const expected = this.confirmationHash(usuarioId, code);
    if (row.confirmHash === null || !safeEqual(row.confirmHash, expected)) {
      return { kind: 'not_found' };
    }
    if (row.confirmExpiresAt === null || row.confirmExpiresAt.getTime() <= this.now().getTime()) {
      await this.repository.expire(row.id);
      return { kind: 'expired' };
    }
    // O que sera emitido e exatamente o que foi mostrado: o resumo regerado confere com o gravado.
    const input: NfseEmissionInput = row.dados;
    if (typeof input !== 'object' || input === null) {
      return { kind: 'not_found' };
    }
    const summaryHash = hashText(
      summarizeInput(input, { ambiente: settings.ambiente, numero: row.numeroDps }),
    );
    if (!safeEqual(summaryHash, row.resumoHash)) {
      return { kind: 'not_found' };
    }

    // O ponto sem volta: so UM chamador ganha.
    const won = await this.repository.consumeConfirmation(
      row.id,
      usuarioId,
      canal,
      expected,
      this.now(),
    );
    if (!won) {
      return { kind: 'already_used', status: NfseEmissionStatus.Enviando };
    }
    await this.recordState(
      usuarioId,
      row.id,
      NfseEmissionStatus.AguardandoConfirmacao,
      NfseEmissionStatus.Enviando,
      null,
      1,
    );

    // A transmissao segue mesmo que o chat desista de esperar: o estado fica no banco.
    // Se ate gravar o resultado falhar (banco fora do ar), o chat recebe "incerta": a linha segue
    // `ENVIANDO` e a proxima consulta a classifica como `INCERTA`. Nunca ha rejeicao nao tratada.
    const transmission = this.transmit(settings, row, input, usuarioId).catch((): EmissionView => ({
      numero: row.numeroDps,
      status: NfseEmissionStatus.Incerta,
      ambiente: settings.tpAmb === 1 ? 'producao' : 'homologacao',
      chaveAcesso: null,
      erroCodigo: 'falha_interna',
      erroMensagem: null,
    }));
    const first = await raceWithDeadline(transmission, this.inlineWaitMs);
    if (first === 'timeout') {
      return { kind: 'processing', numero: row.numeroDps };
    }
    return { kind: 'finished', emission: first };
  }

  /** Nunca lanca: qualquer falha vira um estado gravado. */
  private async transmit(
    settings: NfseSettings,
    row: NfseEmission,
    input: NfseEmissionInput,
    usuarioId: string,
  ): Promise<EmissionView> {
    const finish = async (
      status: NfseEmissionStatus,
      fields: {
        chaveAcesso?: string;
        nfseXml?: string;
        erroCodigo?: string;
        erroMensagem?: string;
      } = {},
    ): Promise<EmissionView> => {
      await this.repository.transition(row.id, NfseEmissionStatus.Enviando, {
        status,
        chaveAcesso: fields.chaveAcesso ?? null,
        nfseXml: fields.nfseXml ?? null,
        erroCodigo: fields.erroCodigo ?? null,
        erroMensagem: fields.erroMensagem ?? null,
      });
      await this.recordState(
        usuarioId,
        row.id,
        NfseEmissionStatus.Enviando,
        status,
        fields.erroCodigo ?? null,
        1,
      );
      const fresh = await this.repository.findById(row.id);
      return fresh === null
        ? {
            numero: row.numeroDps,
            status,
            ambiente: settings.tpAmb === 1 ? 'producao' : 'homologacao',
            chaveAcesso: fields.chaveAcesso ?? null,
            erroCodigo: fields.erroCodigo ?? null,
            erroMensagem: fields.erroMensagem ?? null,
          }
        : view(fresh);
    };

    try {
      let certificate: NfseCertificate;
      try {
        certificate = this.openCertificate(settings);
      } catch {
        return await finish(NfseEmissionStatus.NaoEnviada, {
          erroCodigo: 'certificado_indisponivel',
        });
      }
      // O certificado tem de ser do prestador: assinar DPS de uma empresa com o certificado de outra e
      // rejeicao certa (E0718) e, pior, indicio de configuracao trocada.
      if (certificate.cnpj !== settings.prestadorCnpj) {
        return await finish(NfseEmissionStatus.NaoEnviada, {
          erroCodigo: 'certificado_diverge_do_prestador',
        });
      }

      const dps = buildDpsXml(input, settings, row.numeroDps, this.now());
      if (dps.dpsId !== row.dpsId) {
        // A configuracao mudou depois do pedido: o que foi confirmado nao e mais o que seria emitido.
        return await finish(NfseEmissionStatus.NaoEnviada, { erroCodigo: 'configuracao_alterada' });
      }
      if (!(await validateDpsXml(dps.xml)).valid) {
        return await finish(NfseEmissionStatus.NaoEnviada, { erroCodigo: 'xsd_invalido' });
      }
      const signed = signDps(dps.xml, certificate);
      if (!(await validateDpsXml(signed)).valid) {
        return await finish(NfseEmissionStatus.NaoEnviada, { erroCodigo: 'xsd_assinado_invalido' });
      }

      const client = this.client(settings, certificate);
      const outcome = await client.emit(signed);
      switch (outcome.kind) {
        case 'authorized':
          return await finish(NfseEmissionStatus.Autorizada, {
            chaveAcesso: outcome.chave,
            nfseXml: outcome.nfseXml,
          });
        case 'rejected':
          return await finish(NfseEmissionStatus.Rejeitada, {
            erroCodigo: outcome.code,
            erroMensagem: outcome.message,
          });
        case 'not_sent':
          return await finish(NfseEmissionStatus.NaoEnviada, {
            erroCodigo: outcome.reason.slice(0, 40),
          });
        case 'uncertain':
          return await finish(NfseEmissionStatus.Incerta, {
            erroCodigo: outcome.reason.slice(0, 40),
          });
      }
    } catch (error) {
      if (error instanceof NfseContractUnconfirmedError) {
        return await finish(NfseEmissionStatus.NaoEnviada, {
          erroCodigo: 'contrato_nao_confirmado',
        });
      }
      // Qualquer outra falha depois do ponto sem volta: NAO se sabe se algo saiu.
      return await finish(NfseEmissionStatus.Incerta, { erroCodigo: 'falha_interna' });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Consulta (e reconciliacao do estado incerto)
  // ---------------------------------------------------------------------------------------------

  async status(usuarioId: string, rawRef: string | undefined): Promise<StatusResult> {
    const settings = this.settings();
    if (typeof settings === 'string') {
      return { kind: settings };
    }
    let rows: NfseEmission[];
    if (rawRef === undefined) {
      rows = await this.repository.listRecent(usuarioId, 3);
    } else {
      if (!/^\d{1,9}$/.test(rawRef) || Number(rawRef) < 1) {
        return { kind: 'bad_format' };
      }
      const one = await this.repository.findOfUser(
        usuarioId,
        settings.tpAmb,
        settings.serie,
        Number(rawRef),
      );
      rows = one === null ? [] : [one];
    }
    await this.repository.markStaleAsUncertain(
      usuarioId,
      new Date(this.now().getTime() - STALE_SENDING_MS),
    );

    const items: EmissionView[] = [];
    for (const original of rows) {
      let row = original;
      const fresh = await this.repository.findById(row.id);
      if (fresh !== null) {
        row = fresh;
      }
      if (row.status === NfseEmissionStatus.Incerta) {
        row = (await this.reconcile(settings, row, usuarioId)) ?? row;
      }
      items.push(view(row));
    }
    return { kind: 'list', items };
  }

  /**
   * `INCERTA -> AUTORIZADA` SOMENTE se a Sefin confirmar, por consulta (`GET`), que a DPS gerou NFS-e.
   * "Nao encontrada" NAO prova que nao houve emissao (a consulta pode atrasar), entao o estado continua
   * `INCERTA`. Nenhum caminho daqui emite ou reenvia.
   */
  private async reconcile(
    settings: NfseSettings,
    row: NfseEmission,
    usuarioId: string,
  ): Promise<NfseEmission | null> {
    try {
      const certificate = this.openCertificate(settings);
      const client = this.client(settings, certificate);
      const found = await client.findByDps(row.dpsId);
      if (found.kind !== 'found') {
        return null;
      }
      const document = await client.fetchNfse(found.chave);
      const moved = await this.repository.transition(row.id, NfseEmissionStatus.Incerta, {
        status: NfseEmissionStatus.Autorizada,
        chaveAcesso: found.chave,
        nfseXml: document.kind === 'ok' ? document.nfseXml : null,
        erroCodigo: null,
        erroMensagem: null,
      });
      if (moved) {
        await this.recordState(
          usuarioId,
          row.id,
          NfseEmissionStatus.Incerta,
          NfseEmissionStatus.Autorizada,
          'reconciliada',
          row.tentativas,
        );
      }
      return await this.repository.findById(row.id);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------------------------

  private confirmationHash(usuarioId: string, code: string): string {
    return hashText(`nfse-confirm:${usuarioId}:${code}`);
  }

  private openCertificate(settings: NfseSettings): NfseCertificate {
    const key = `${settings.certPfxPath}\u0000${settings.certPfxPassword}`;
    if (
      this.certificateCache?.key !== key ||
      this.certificateCache.certificate.notAfter < this.now()
    ) {
      this.certificateCache = { key, certificate: this.certificateLoader(settings) };
    }
    return this.certificateCache.certificate;
  }

  private client(settings: NfseSettings, certificate: NfseCertificate): NfseApiClient {
    return new NfseApiClient(settings, this.transportFactory(settings, certificate));
  }

  private async recordState(
    usuarioId: string,
    emissaoId: string,
    de: NfseEmissionStatus,
    para: NfseEmissionStatus,
    codigo: string | null,
    tentativa: number,
  ): Promise<void> {
    try {
      await this.audit.record({
        usuarioId,
        acao: AuditAction.NfseStateChanged,
        modulo: AuditModuleName.Nfse,
        descricao: `NFS-e: ${de} -> ${para}`,
        metadados: { emissaoId, de, para, tentativa, ...(codigo === null ? {} : { codigo }) },
      });
    } catch {
      // A auditoria nunca derruba a emissao (o `AuditService` ja registra a propria falha).
    }
  }
}
