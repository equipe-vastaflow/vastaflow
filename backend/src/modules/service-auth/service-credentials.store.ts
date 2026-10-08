import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { SERVICE_CREDENTIALS_TTL_MS } from './service-auth.constants';
import {
  parseCredentialsFile,
  type ServiceCredentialRecord,
  type ServiceCredentialsFile,
} from './service-credentials.file';
import { type AuthenticatedService, SERVICE_PRINCIPALS } from './service-principals';
import { hashServiceToken } from './service-token';

/**
 * Por que uma credencial foi recusada. So vai para o LOG: a resposta HTTP e
 * sempre a mesma, para nao revelar a quem esta do lado de fora qual foi o caso.
 */
export type CredentialDenial =
  'not_configured' | 'store_unavailable' | 'store_invalid' | 'unknown' | 'revoked' | 'expired';

export type CredentialLookup =
  | { readonly ok: true; readonly service: AuthenticatedService }
  | { readonly ok: false; readonly reason: CredentialDenial };

export interface ServiceCredentialsStoreOptions {
  /** Caminho do arquivo. Ausente = recurso desligado: toda credencial e negada. */
  readonly path: string | undefined;
  readonly ttlMs?: number;
  /** Relogio em ms desde a epoca. Injetavel para teste. */
  readonly now?: () => number;
  /** Leitura do arquivo. Injetavel para teste. */
  readonly readFile?: (path: string) => string;
}

type State =
  | { readonly kind: 'ok'; readonly file: ServiceCredentialsFile }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'invalid' };

interface Snapshot {
  readonly loadedAt: number;
  readonly state: State;
}

/**
 * Fonte das credenciais de servico: um arquivo de HASHES relido periodicamente.
 *
 * ## Por que arquivo, e nao variavel de ambiente nem tabela
 *
 * - **Variavel de ambiente** so muda reiniciando o container. Revogar uma
 *   credencial comprometida exigiria reinicio - e a revogacao deixaria de ser
 *   "imediata".
 * - **Tabela no banco** daria revogacao dinamica, mas exige migration (MySQL e
 *   Oracle), entidade e uma interface de administracao que nao existe - o
 *   painel nao recebe funcionalidade nova. E o caminho de evolucao se surgirem
 *   muitos principais.
 * - **Arquivo relido** revoga SEM reiniciar: o arquivo e lido de novo a cada
 *   `ttlMs` (1 s). A latencia de uma revogacao e esse teto, somada ao tempo que
 *   o bind mount leva para propagar a gravacao ao container - que depende do
 *   sistema de arquivos do host e NAO e controlado por esta classe.
 *
 * ## Falha fechada
 *
 * Arquivo ausente, ilegivel ou invalido NEGA todo acesso. Nunca mantem a "ultima
 * versao boa": se o operador revogar uma credencial e a gravacao sair corrompida,
 * continuar valendo com a copia antiga reativaria a credencial que ele acabou de
 * revogar.
 */
export class ServiceCredentialsStore {
  private readonly logger = new Logger(ServiceCredentialsStore.name);
  private readonly path: string | undefined;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly readFile: (path: string) => string;

  private snapshot: Snapshot | undefined;
  /** Assinatura do ultimo estado LOGADO, para registrar so as mudancas. */
  private lastLogged: string | undefined;

  constructor(options: ServiceCredentialsStoreOptions) {
    this.path = options.path;
    this.ttlMs = options.ttlMs ?? SERVICE_CREDENTIALS_TTL_MS;
    this.now = options.now ?? ((): number => Date.now());
    this.readFile = options.readFile ?? ((file): string => readFileSync(file, 'utf8'));
  }

  /**
   * Procura o token entre as credenciais.
   *
   * A comparacao percorre TODAS as credenciais, sem sair no primeiro acerto: o
   * tempo gasto nao depende de qual delas casou nem de em que posicao.
   */
  find(token: string): CredentialLookup {
    if (this.path === undefined) {
      return { ok: false, reason: 'not_configured' };
    }

    const { state } = this.current(this.path);
    if (state.kind === 'unavailable') {
      return { ok: false, reason: 'store_unavailable' };
    }
    if (state.kind === 'invalid') {
      return { ok: false, reason: 'store_invalid' };
    }

    const digest = Buffer.from(hashServiceToken(token), 'hex');
    let match: ServiceCredentialRecord | undefined;
    for (const record of state.file.credentials) {
      const same = timingSafeEqual(Buffer.from(record.sha256, 'hex'), digest);
      if (same && match === undefined) {
        match = record;
      }
    }

    if (match === undefined) {
      return { ok: false, reason: 'unknown' };
    }
    if (match.status === 'revoked') {
      return { ok: false, reason: 'revoked' };
    }
    if (match.expiresAt !== undefined && Date.parse(match.expiresAt) <= this.now()) {
      return { ok: false, reason: 'expired' };
    }

    return {
      ok: true,
      service: {
        principal: match.principal,
        credentialId: match.id,
        scopes: SERVICE_PRINCIPALS[match.principal].scopes,
      },
    };
  }

  private current(path: string): Snapshot {
    const now = this.now();
    if (this.snapshot !== undefined && now - this.snapshot.loadedAt < this.ttlMs) {
      return this.snapshot;
    }
    this.snapshot = { loadedAt: now, state: this.load(path) };
    return this.snapshot;
  }

  private load(path: string): State {
    let text: string;
    try {
      text = this.readFile(path);
    } catch {
      this.logChange('unavailable', () =>
        this.logger.error(
          'Arquivo de credenciais de servico ausente ou ilegivel: todo acesso de servico sera negado',
        ),
      );
      return { kind: 'unavailable' };
    }

    // Assinatura do CONTEUDO, para logar so quando ele muda. SHA-256 do arquivo
    // inteiro: o arquivo contem apenas hashes, e nada disto vai para o log.
    const signature = createHash('sha256').update(text, 'utf8').digest('hex');

    try {
      const file = parseCredentialsFile(text);
      this.logChange(`ok:${signature}`, () => this.logSummary(file));
      return { kind: 'ok', file };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'motivo desconhecido';
      this.logChange(`invalid:${signature}`, () =>
        this.logger.error(
          `Arquivo de credenciais de servico INVALIDO (${reason}): todo acesso de servico sera negado`,
        ),
      );
      return { kind: 'invalid' };
    }
  }

  /** Registra a mudanca de estado UMA vez, em vez de a cada releitura. */
  private logChange(signature: string, log: () => void): void {
    if (this.lastLogged === signature) {
      return;
    }
    this.lastLogged = signature;
    log();
  }

  /** Rastro de rotacao/revogacao: quais credenciais estao ativas AGORA. Sem hashes. */
  private logSummary(file: ServiceCredentialsFile): void {
    const now = this.now();
    const live = file.credentials.filter(
      (c) => c.status === 'active' && (c.expiresAt === undefined || Date.parse(c.expiresAt) > now),
    );
    const revoked = file.credentials.filter((c) => c.status === 'revoked').length;
    this.logger.log(
      `Credenciais de servico carregadas: ativas=[${live.map((c) => `${c.principal}/${c.id}`).join(', ')}] ` +
        `revogadas=${revoked} total=${file.credentials.length}`,
    );
  }
}
