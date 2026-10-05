import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UserDirectoryService, type UserIdentity } from '../users/user-directory.service';
import { checkUploadedFile, type UploadedFileLike } from './document-file.policy';
import { DocumentsRepository } from './documents.repository';
import type { Document } from './entities/document.entity';
import { generateStorageKey } from './storage/storage-key';
import {
  DOCUMENT_STORAGE,
  StorageObjectNotFoundError,
  type StoragePort,
  type StoredObject,
} from './storage/storage.port';

/** Documento com o autor ja resolvido. `autor` ausente = usuario nao existe mais. */
export interface DocumentWithAuthor {
  document: Document;
  autor?: UserIdentity;
}

export interface DocumentPage {
  items: DocumentWithAuthor[];
  total: number;
}

/** Documento pronto para download: o registro e o objeto aberto no storage. */
export interface DocumentDownload {
  document: Document;
  object: StoredObject;
}

/**
 * Regras do dominio de documentos.
 *
 * NAO conhece filesystem nem AWS: fala com a `StoragePort`, que e injetada. E o
 * que permite trocar o adapter local pelo de S3 sem tocar aqui, nos controllers,
 * no RBAC, na auditoria nem nas regras de validacao.
 *
 * `criado_por_id` e metadado de auditoria, NAO isolamento: quem tem
 * `documents:read` ve todos os documentos. Nao ha dono, ACL nem
 * compartilhamento nesta fase.
 *
 * A auditoria e BEST-EFFORT, como no resto do sistema: gravada depois da
 * operacao, e uma falha ao grava-la vai para o log sem desfazer nada.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repository: DocumentsRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: StoragePort,
    private readonly userDirectory: UserDirectoryService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Recebe o arquivo, grava os bytes e persiste o documento.
   *
   * Ordem: STORAGE -> BANCO -> AUDITORIA. A assimetria entre as duas falhas
   * possiveis e o que define essa ordem:
   *
   * - bytes gravados e banco falhando deixa um objeto que NINGUEM referencia -
   *   desperdicio de espaco, invisivel a aplicacao;
   * - banco gravado e bytes falhando deixa um documento que APARECE na listagem
   *   e nao baixa - corrupcao visivel ao usuario.
   *
   * O primeiro e aceitavel, o segundo nao. Por isso nunca a ordem inversa.
   *
   * Se o banco falhar, os bytes sao removidos em regime best-effort. Storage
   * externo NAO participa da transacao SQL, e nao ha transacao distribuida nem
   * outbox aqui: a compensacao e explicita e pode falhar.
   *
   * @throws BadRequestException arquivo ausente, vazio, grande demais, nome
   *   invalido, extensao nao permitida ou MIME incoerente.
   */
  async create(
    actor: AuthenticatedUser,
    file: UploadedFileLike | undefined,
    ip: string | null,
  ): Promise<DocumentWithAuthor> {
    const maxFileSize = this.config.get('DOCUMENT_MAX_FILE_SIZE', { infer: true });

    const verificacao = checkUploadedFile(file, maxFileSize);
    if (!verificacao.ok) {
      throw new BadRequestException(verificacao.erro);
    }
    // `checkUploadedFile` ja garantiu que o arquivo existe.
    const arquivo = file as UploadedFileLike;

    // Chave sempre do servidor: o cliente nao escolhe onde o objeto mora, e o
    // nome que ele enviou nao entra no caminho fisico.
    const storageKey = generateStorageKey();
    await this.storage.write(storageKey, arquivo.buffer);

    let salvo: Document;
    try {
      salvo = await this.repository.create({
        nome: arquivo.originalname,
        nomeOriginal: arquivo.originalname,
        mimeType: arquivo.mimetype,
        tamanho: arquivo.buffer.length,
        storageKey,
        criadoPorId: actor.id,
      });
    } catch (error) {
      await this.rollbackStorage(storageKey, error);
      // Repropaga o erro ORIGINAL: a falha do banco e a causa, e esconde-la
      // atras de uma falha de limpeza deixaria o problema real sem rastro.
      throw error;
    }

    await this.audit(actor, AuditAction.DocumentCreated, ip, {
      alvoId: salvo.id,
      nome: salvo.nome,
      mimeType: salvo.mimeType,
      tamanho: salvo.tamanho,
    });

    return { document: salvo, autor: toIdentity(actor) };
  }

  /**
   * Pagina de documentos com o autor de cada um.
   *
   * Duas consultas por pagina, sempre: a pagina (com `COUNT`) e UMA busca em
   * lote dos autores - nunca uma consulta por documento.
   */
  async list(page: number, limit: number): Promise<DocumentPage> {
    const [documents, total] = await this.repository.findPage((page - 1) * limit, limit);
    const autores = await this.userDirectory.findByIds(
      documents.map((document) => document.criadoPorId),
    );

    return {
      items: documents.map((document) => ({
        document,
        autor: autores.get(document.criadoPorId),
      })),
      total,
    };
  }

  /**
   * Abre o documento para download e registra o acesso.
   *
   * O arquivo NAO e carregado em memoria: a `StoragePort` devolve um stream, que
   * o controller encaminha para a resposta.
   *
   * @throws NotFoundException documento inexistente.
   * @throws InternalServerErrorException registro existe mas o objeto nao esta
   *   no storage - inconsistencia, nao "nao encontrado".
   */
  async download(
    actor: AuthenticatedUser,
    id: string,
    ip: string | null,
  ): Promise<DocumentDownload> {
    const document = await this.repository.findById(id);
    if (!document) {
      throw new NotFoundException('Documento nao encontrado');
    }

    let object: StoredObject;
    try {
      object = await this.storage.read(document.storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        // Deliberadamente NAO e 404: o documento existe no banco e o objeto
        // sumiu do storage. Responder "nao encontrado" esconderia uma
        // inconsistencia que alguem precisa investigar. A chave fisica fica
        // apenas no log, nunca na resposta.
        this.logger.error(
          `Documento ${document.id} sem objeto no storage (chave ${document.storageKey})`,
        );
        throw new InternalServerErrorException();
      }
      this.logger.error(
        `Falha ao ler o documento ${document.id} do storage`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException();
    }

    await this.audit(actor, AuditAction.DocumentDownloaded, ip, {
      alvoId: document.id,
      nome: document.nome,
      tamanho: document.tamanho,
    });

    return { document, object };
  }

  /**
   * Remove os bytes depois de o banco falhar. Best-effort, por contrato.
   *
   * Uma falha aqui NAO substitui o erro original: ela e registrada e o erro do
   * banco segue subindo. O pior caso e um objeto orfao, que nenhum registro
   * referencia e que nenhuma rota alcanca.
   */
  private async rollbackStorage(storageKey: string, erroOriginal: unknown): Promise<void> {
    try {
      await this.storage.remove(storageKey);
    } catch (falhaNaLimpeza) {
      this.logger.error(
        `Objeto orfao no storage (chave ${storageKey}): a persistencia falhou e a remocao tambem. ` +
          `Causa original: ${describe(erroOriginal)}. Falha na remocao: ${describe(falhaNaLimpeza)}`,
      );
    }
  }

  private audit(
    actor: AuthenticatedUser,
    acao: AuditAction,
    ip: string | null,
    metadados: Record<string, unknown>,
  ): Promise<void> {
    return this.auditService.record({
      usuarioId: actor.id,
      acao,
      modulo: AuditModuleName.Documents,
      // Sem conteudo, sem bytes, sem base64 e sem a chave fisica: a trilha
      // responde quem fez o que, e o conteudo se consulta pela API.
      descricao: `Documento ${String(metadados.alvoId)} por ${actor.email}`,
      ip,
      metadados,
    });
  }
}

function toIdentity(actor: AuthenticatedUser): UserIdentity {
  return { id: actor.id, nome: actor.nome, email: actor.email };
}

/** Mensagem curta de um erro, para log. Nunca inclui stack nem dado do arquivo. */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
