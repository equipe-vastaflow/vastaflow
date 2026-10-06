import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { EnvironmentVariables } from '../../config/env.validation';
import { RoleName } from '../roles/role-name.enum';
import type { UserDirectoryService } from '../users/user-directory.service';
import { DocumentsService } from './documents.service';
import type { DocumentsRepository } from './documents.repository';
import type { UploadedFileLike } from './document-file.policy';
import type { Document } from './entities/document.entity';
import { InMemoryStorageAdapter } from './storage/in-memory-storage.adapter';
import { isSafeStorageKey } from './storage/storage-key';
import { StorageObjectNotFoundError, StorageWriteError } from './storage/storage.port';

const ACTOR: AuthenticatedUser = {
  id: 'user-1',
  nome: 'Maria Silva',
  email: 'maria@example.com',
  role: RoleName.Gestor,
  permissions: [],
  ativo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function arquivo(overrides: Partial<UploadedFileLike> = {}): UploadedFileLike {
  return {
    originalname: 'contrato.pdf',
    mimetype: 'application/pdf',
    size: 4,
    buffer: Buffer.from('%PDF'),
    ...overrides,
  };
}

function documento(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    nome: 'contrato.pdf',
    nomeOriginal: 'contrato.pdf',
    mimeType: 'application/pdf',
    tamanho: 4,
    storageKey: '2026/10/05/11111111-2222-3333-4444-555555555555.bin',
    criadoPorId: ACTOR.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DocumentsService', () => {
  type RepositoryMock = jest.Mocked<Pick<DocumentsRepository, 'create' | 'findById' | 'findPage'>>;

  let repository: RepositoryMock;
  let storage: InMemoryStorageAdapter;
  let userDirectory: jest.Mocked<Pick<UserDirectoryService, 'findByIds'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: DocumentsService;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      create: jest.fn((data) => Promise.resolve(documento(data))),
      findById: jest.fn().mockResolvedValue(documento()),
      findPage: jest.fn().mockResolvedValue([[documento()], 1]),
    };
    storage = new InMemoryStorageAdapter();
    userDirectory = {
      findByIds: jest
        .fn()
        .mockResolvedValue(
          new Map([[ACTOR.id, { id: ACTOR.id, nome: ACTOR.nome, email: ACTOR.email }]]),
        ),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };

    const config = {
      get: (): number => MAX_FILE_SIZE,
    } as unknown as ConfigService<EnvironmentVariables, true>;

    service = new DocumentsService(
      repository as unknown as DocumentsRepository,
      storage,
      userDirectory as unknown as UserDirectoryService,
      auditService as unknown as AuditService,
      config,
    );

    // O service registra falhas de storage e inconsistencia; silenciar o log
    // mantem a saida do teste legivel sem esconder a chamada.
    logError = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  describe('create', () => {
    it('grava os bytes e persiste os metadados', async () => {
      const { document } = await service.create(ACTOR, arquivo(), null);

      expect(storage.size()).toBe(1);
      expect(storage.has(document.storageKey)).toBe(true);
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('a chave fisica e gerada pelo servidor e nao vem do nome enviado', async () => {
      const { document } = await service.create(
        ACTOR,
        arquivo({ originalname: '../../etc/passwd.pdf' }),
        null,
      );

      expect(isSafeStorageKey(document.storageKey)).toBe(true);
      expect(document.storageKey).not.toContain('passwd');
      expect(document.storageKey).not.toContain('..');
    });

    it('o nome enviado e preservado como metadado', async () => {
      const nome = 'Contrato João Pedro.pdf';

      const { document } = await service.create(ACTOR, arquivo({ originalname: nome }), null);

      expect(document.nomeOriginal).toBe(nome);
      expect(document.nome).toBe(nome);
    });

    it('o autor e sempre o usuario autenticado', async () => {
      const { document, autor } = await service.create(ACTOR, arquivo(), null);

      expect(document.criadoPorId).toBe(ACTOR.id);
      expect(autor).toEqual({ id: ACTOR.id, nome: ACTOR.nome, email: ACTOR.email });
    });

    it('o tamanho vem do buffer, nao do campo informado', async () => {
      const { document } = await service.create(
        ACTOR,
        arquivo({ buffer: Buffer.alloc(1234), size: 1 }),
        null,
      );

      expect(document.tamanho).toBe(1234);
    });

    it.each([
      ['arquivo ausente', undefined],
      ['arquivo vazio', arquivo({ buffer: Buffer.alloc(0) })],
      ['extensao proibida', arquivo({ originalname: 'x.exe', mimetype: 'application/pdf' })],
      ['MIME incoerente', arquivo({ originalname: 'x.pdf', mimetype: 'text/html' })],
      ['nome vazio', arquivo({ originalname: '' })],
    ])('recusa %s com 400, sem gravar nada', async (_caso, file) => {
      await expect(service.create(ACTOR, file, null)).rejects.toBeInstanceOf(BadRequestException);

      // Nem storage, nem banco, nem auditoria.
      expect(storage.size()).toBe(0);
      expect(repository.create).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('recusa arquivo acima do limite configurado', async () => {
      const config = { get: (): number => 10 } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >;
      const restrito = new DocumentsService(
        repository as unknown as DocumentsRepository,
        storage,
        userDirectory as unknown as UserDirectoryService,
        auditService as unknown as AuditService,
        config,
      );

      await expect(
        restrito.create(ACTOR, arquivo({ buffer: Buffer.alloc(11) }), null),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.size()).toBe(0);
    });

    describe('falha do storage', () => {
      it('propaga o erro e NAO cria registro no banco', async () => {
        jest.spyOn(storage, 'write').mockRejectedValue(new StorageWriteError('chave'));

        await expect(service.create(ACTOR, arquivo(), null)).rejects.toBeInstanceOf(
          StorageWriteError,
        );

        // O cenario que importa: nenhum documento fantasma na listagem.
        expect(repository.create).not.toHaveBeenCalled();
        expect(auditService.record).not.toHaveBeenCalled();
      });
    });

    describe('falha do banco depois de gravar os bytes', () => {
      const erroDoBanco = new Error('ER_DUP_ENTRY');

      beforeEach(() => {
        repository.create.mockRejectedValue(erroDoBanco);
      });

      it('remove os bytes gravados', async () => {
        await expect(service.create(ACTOR, arquivo(), null)).rejects.toThrow(erroDoBanco);

        // Rollback compensatorio: o storage nao participa da transacao SQL.
        expect(storage.size()).toBe(0);
      });

      it('repropaga o erro ORIGINAL do banco', async () => {
        // Esconder a causa atras de uma falha de limpeza deixaria o problema
        // real sem rastro.
        await expect(service.create(ACTOR, arquivo(), null)).rejects.toBe(erroDoBanco);
      });

      it('NAO registra DOCUMENT_CREATED', async () => {
        await expect(service.create(ACTOR, arquivo(), null)).rejects.toThrow();

        expect(auditService.record).not.toHaveBeenCalled();
      });

      it('se a remocao TAMBEM falhar, o erro do banco continua sendo o propagado', async () => {
        jest.spyOn(storage, 'remove').mockRejectedValue(new Error('storage fora do ar'));

        await expect(service.create(ACTOR, arquivo(), null)).rejects.toBe(erroDoBanco);
      });

      it('se a remocao falhar, o objeto orfao e registrado no log', async () => {
        jest.spyOn(storage, 'remove').mockRejectedValue(new Error('storage fora do ar'));

        await expect(service.create(ACTOR, arquivo(), null)).rejects.toThrow();

        expect(logError).toHaveBeenCalledTimes(1);
        const [mensagem] = logError.mock.calls[0] as [string];
        // Informacao suficiente para investigar: a chave orfa e as duas causas.
        expect(mensagem).toContain('orfao');
        expect(mensagem).toContain('ER_DUP_ENTRY');
        expect(mensagem).toContain('storage fora do ar');
      });
    });

    describe('auditoria', () => {
      it('registra DOCUMENT_CREATED com identificacao, tipo e tamanho', async () => {
        const { document } = await service.create(ACTOR, arquivo(), '203.0.113.7');

        expect(auditService.record).toHaveBeenCalledTimes(1);
        expect(auditService.record).toHaveBeenCalledWith({
          usuarioId: ACTOR.id,
          acao: AuditAction.DocumentCreated,
          modulo: AuditModuleName.Documents,
          descricao: `Documento ${document.id} por ${ACTOR.email}`,
          ip: '203.0.113.7',
          metadados: {
            alvoId: document.id,
            nome: 'contrato.pdf',
            mimeType: 'application/pdf',
            tamanho: 4,
          },
        });
      });

      it('NAO registra conteudo, bytes, base64 nem a chave fisica', async () => {
        const conteudoSigiloso = Buffer.from('SEGREDO-DENTRO-DO-ARQUIVO');

        const { document } = await service.create(
          ACTOR,
          arquivo({ buffer: conteudoSigiloso }),
          null,
        );

        const registrado = JSON.stringify(auditService.record.mock.calls[0][0]);
        expect(registrado).not.toContain('SEGREDO-DENTRO-DO-ARQUIVO');
        expect(registrado).not.toContain(conteudoSigiloso.toString('base64'));
        expect(registrado).not.toContain(document.storageKey);
      });
    });
  });

  describe('list', () => {
    it('converte a pagina no deslocamento do banco', async () => {
      await service.list(1, 20);
      expect(repository.findPage).toHaveBeenCalledWith(0, 20);

      await service.list(3, 10);
      expect(repository.findPage).toHaveBeenLastCalledWith(20, 10);
    });

    it('resolve os autores numa UNICA busca, sem N+1', async () => {
      repository.findPage.mockResolvedValue([
        [documento({ id: 'a' }), documento({ id: 'b' }), documento({ id: 'c', criadoPorId: 'u2' })],
        3,
      ]);

      await service.list(1, 20);

      expect(userDirectory.findByIds).toHaveBeenCalledTimes(1);
      expect(userDirectory.findByIds).toHaveBeenCalledWith([ACTOR.id, ACTOR.id, 'u2']);
    });

    it('autor removido do sistema nao quebra a listagem', async () => {
      userDirectory.findByIds.mockResolvedValue(new Map());

      const { items } = await service.list(1, 20);

      expect(items[0].autor).toBeUndefined();
    });

    it('listar NAO gera auditoria', async () => {
      await service.list(1, 20);

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('listar nao toca no storage', async () => {
      const read = jest.spyOn(storage, 'read');

      await service.list(1, 20);

      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    const CHAVE = '2026/10/05/11111111-2222-3333-4444-555555555555.bin';

    beforeEach(async () => {
      await storage.write(CHAVE, Buffer.from('%PDF-conteudo'));
    });

    it('devolve o documento e o objeto aberto', async () => {
      const { document, object } = await service.download(ACTOR, 'doc-1', null);

      expect(document.id).toBe('doc-1');
      expect(object.size).toBe('%PDF-conteudo'.length);
    });

    it('documento inexistente: 404', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.download(ACTOR, 'nao-existe', null)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('registro no banco sem objeto no storage: NAO e 404', async () => {
      // Responder "nao encontrado" esconderia uma inconsistencia que alguem
      // precisa investigar.
      await storage.remove(CHAVE);

      await expect(service.download(ACTOR, 'doc-1', null)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      await expect(service.download(ACTOR, 'doc-1', null)).rejects.not.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('a inconsistencia e registrada no log, com a chave', async () => {
      await storage.remove(CHAVE);

      await expect(service.download(ACTOR, 'doc-1', null)).rejects.toThrow();

      const [mensagem] = logError.mock.calls[0] as [string];
      expect(mensagem).toContain('doc-1');
      expect(mensagem).toContain(CHAVE);
    });

    it('a resposta de inconsistencia NAO leva a chave fisica', async () => {
      await storage.remove(CHAVE);

      const erro = await service.download(ACTOR, 'doc-1', null).catch((e: unknown) => e);

      expect(JSON.stringify(erro)).not.toContain(CHAVE);
      expect(String(erro)).not.toContain(CHAVE);
    });

    it('falha generica de leitura tambem nao vaza detalhe', async () => {
      jest
        .spyOn(storage, 'read')
        .mockRejectedValue(new Error('EACCES /var/storage/documents/2026 permission denied'));

      const erro = await service.download(ACTOR, 'doc-1', null).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(InternalServerErrorException);
      expect(JSON.stringify(erro)).not.toContain('/var/storage');
      expect(JSON.stringify(erro)).not.toContain('EACCES');
    });

    it('falha de leitura NAO gera auditoria de download', async () => {
      jest.spyOn(storage, 'read').mockRejectedValue(new StorageObjectNotFoundError(CHAVE));

      await expect(service.download(ACTOR, 'doc-1', null)).rejects.toThrow();

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('registra DOCUMENT_DOWNLOADED com identificacao e tamanho', async () => {
      await service.download(ACTOR, 'doc-1', '203.0.113.7');

      expect(auditService.record).toHaveBeenCalledWith({
        usuarioId: ACTOR.id,
        acao: AuditAction.DocumentDownloaded,
        modulo: AuditModuleName.Documents,
        descricao: `Documento doc-1 por ${ACTOR.email}`,
        ip: '203.0.113.7',
        metadados: { alvoId: 'doc-1', nome: 'contrato.pdf', tamanho: 4 },
      });
    });

    it('a auditoria do download nao leva a chave fisica', async () => {
      await service.download(ACTOR, 'doc-1', null);

      expect(JSON.stringify(auditService.record.mock.calls[0][0])).not.toContain(CHAVE);
    });

    it('quem baixa pode ser outro usuario: nao ha dono', async () => {
      // `criado_por_id` e metadado de auditoria, nao isolamento de acesso.
      const outro: AuthenticatedUser = { ...ACTOR, id: 'user-2', email: 'outro@example.com' };

      const { document } = await service.download(outro, 'doc-1', null);

      expect(document.criadoPorId).toBe(ACTOR.id);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: 'user-2' }),
      );
    });
  });
});
