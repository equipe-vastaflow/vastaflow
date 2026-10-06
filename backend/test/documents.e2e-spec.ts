import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuditAction } from '../src/modules/audit/audit-action.enum';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { DocumentPageResponseDto } from '../src/modules/documents/dto/document-page-response.dto';
import type { DocumentResponseDto } from '../src/modules/documents/dto/document-response.dto';
import { InMemoryStorageAdapter } from '../src/modules/documents/storage/in-memory-storage.adapter';
import { DOCUMENT_STORAGE } from '../src/modules/documents/storage/storage.port';
import { DocumentsRepository } from '../src/modules/documents/documents.repository';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';
const PDF = Buffer.from('%PDF-1.7 conteudo de teste');

/**
 * UUID sintaticamente valido (versao 4, variante 8) que nao existe no banco.
 *
 * Precisa ser valido de verdade: o `ParseUUIDPipe` recusa com 400 um UUID de
 * variante errada, e o teste mediria a validacao do pipe em vez do 404.
 */
const UUID_INEXISTENTE = '11111111-1111-4111-8111-111111111111';

describe('Documentos (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let storage: InMemoryStorageAdapter;
  let documentsRepository: DocumentsRepository;
  let adminToken: string;
  /** GESTOR: recebe `documents:read` e `documents:create` pelo seeder. */
  let gestorToken: string;
  /** USUARIO: nenhuma permissao de documento. */
  let semPermissaoToken: string;
  let counter = 0;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;
  const uniqueEmail = (prefix = 'user'): string => `${prefix}${++counter}@vasta.test`;

  async function login(email: string, senha: string): Promise<AuthResponseDto> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return response.body as AuthResponseDto;
  }

  async function tokenFor(role: RoleName): Promise<string> {
    const email = uniqueEmail(role.toLowerCase());
    await usersService.create({ nome: `Teste ${role}`, email, senha: VALID_PASSWORD, role });
    return (await login(email, VALID_PASSWORD)).accessToken;
  }

  /** Envia um arquivo como multipart. O supertest monta o boundary. */
  function enviar(
    token = adminToken,
    conteudo: Buffer = PDF,
    nome = 'contrato.pdf',
    contentType = 'application/pdf',
  ): request.Test {
    return request(server())
      .post('/documents')
      .set('Authorization', bearer(token))
      .attach('arquivo', conteudo, { filename: nome, contentType });
  }

  async function enviarOk(nome = 'contrato.pdf'): Promise<DocumentResponseDto> {
    const resposta = await enviar(adminToken, PDF, nome).expect(201);
    return resposta.body as DocumentResponseDto;
  }

  /** Baixa o documento com o corpo em Buffer. */
  function baixar(id: string, token = adminToken): request.Test {
    return request(server())
      .get(`/documents/${id}/download`)
      .set('Authorization', bearer(token))
      .buffer(true)
      .parse((res, callback) => {
        const pedacos: Buffer[] = [];
        res.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
        res.on('end', () => callback(null, Buffer.concat(pedacos)));
      });
  }

  async function registrosDeAuditoria(
    acao: AuditAction,
  ): Promise<AuditLogPageResponseDto['items']> {
    const resposta = await request(server())
      .get('/audit-logs')
      .query({ limit: '100' })
      .set('Authorization', bearer(adminToken))
      .expect(200);
    const esperada: string = acao;
    return (resposta.body as AuditLogPageResponseDto).items.filter(
      (item) => item.acao === esperada,
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    usersService = app.get(UsersService, { strict: false });
    storage = app.get(DOCUMENT_STORAGE, { strict: false });
    documentsRepository = app.get(DocumentsRepository, { strict: false });
    adminToken = (await login(ADMIN.email, ADMIN.senha)).accessToken;
    gestorToken = await tokenFor(RoleName.Gestor);
    semPermissaoToken = await tokenFor(RoleName.Usuario);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('autorizacao', () => {
    it('POST /documents sem token: 401', async () => {
      await request(server())
        .post('/documents')
        .attach('arquivo', PDF, { filename: 'x.pdf', contentType: 'application/pdf' })
        .expect(401);
    });

    it('POST /documents sem documents:create: 403', async () => {
      await enviar(semPermissaoToken).expect(403);
    });

    it('GET /documents sem token: 401', async () => {
      await request(server()).get('/documents').expect(401);
    });

    it('GET /documents sem documents:read: 403', async () => {
      await request(server())
        .get('/documents')
        .set('Authorization', bearer(semPermissaoToken))
        .expect(403);
    });

    it('download sem documents:read: 403', async () => {
      const documento = await enviarOk();

      await baixar(documento.id, semPermissaoToken).expect(403);
    });

    it('GESTOR tem as duas permissoes pelo seeder', async () => {
      const enviado = await enviar(gestorToken).expect(201);

      await request(server())
        .get('/documents')
        .set('Authorization', bearer(gestorToken))
        .expect(200);
      await baixar((enviado.body as DocumentResponseDto).id, gestorToken).expect(200);
    });

    it('recusa de permissao acontece ANTES de qualquer gravacao', async () => {
      const antes = storage.size();

      await enviar(semPermissaoToken).expect(403);

      expect(storage.size()).toBe(antes);
    });
  });

  describe('POST /documents', () => {
    it('upload valido devolve 201 e os metadados', async () => {
      const documento = await enviarOk('Contrato de servico.pdf');

      expect(documento).toMatchObject({
        nome: 'Contrato de servico.pdf',
        nomeOriginal: 'Contrato de servico.pdf',
        mimeType: 'application/pdf',
        tamanho: PDF.length,
      });
      expect(typeof documento.id).toBe('string');
    });

    it('o arquivo fica REALMENTE armazenado, com o mesmo conteudo', async () => {
      const documento = await enviarOk();

      const baixado = await baixar(documento.id).expect(200);
      expect(baixado.body as Buffer).toEqual(PDF);
    });

    it('o documento fica REALMENTE persistido no banco', async () => {
      const documento = await enviarOk();

      const doBanco = await documentsRepository.findById(documento.id);
      expect(doBanco).not.toBeNull();
      expect(doBanco?.nomeOriginal).toBe('contrato.pdf');
      expect(doBanco?.tamanho).toBe(PDF.length);
    });

    it('o tamanho volta como NUMBER, nunca string', async () => {
      // A coluna e decimal; o MySQL a devolve como string. Sem o transformer, o
      // tipo do JSON mudaria conforme o banco.
      const documento = await enviarOk();

      expect(typeof documento.tamanho).toBe('number');
    });

    it('a resposta NAO expoe a chave de storage nem caminho fisico', async () => {
      const documento = await enviarOk();

      const serializado = JSON.stringify(documento);
      expect(serializado).not.toMatch(/storageKey|storage_key|\.bin/);
      expect(serializado).not.toMatch(/[A-Za-z]:\\|\/tmp|\/var|AppData/);
      expect(Object.keys(documento).sort()).toEqual([
        'createdAt',
        'criadoPor',
        'criadoPorId',
        'id',
        'mimeType',
        'nome',
        'nomeOriginal',
        'tamanho',
        'updatedAt',
      ]);
    });

    it('o autor e o usuario autenticado, resolvido pelo backend', async () => {
      const documento = await enviarOk();

      expect(documento.criadoPor?.email).toBe(ADMIN.email);
      expect(documento.criadoPorId).toBe(documento.criadoPor?.id);
    });

    it('gera DOCUMENT_CREATED, sem conteudo do arquivo', async () => {
      const antes = (await registrosDeAuditoria(AuditAction.DocumentCreated)).length;

      const documento = await enviarOk();

      const registros = await registrosDeAuditoria(AuditAction.DocumentCreated);
      expect(registros).toHaveLength(antes + 1);

      const serializado = JSON.stringify(registros);
      expect(serializado).toContain(documento.id);
      expect(serializado).not.toContain(PDF.toString('utf8'));
      expect(serializado).not.toContain(PDF.toString('base64'));
    });

    it('sem arquivo no campo esperado: 400', async () => {
      await request(server())
        .post('/documents')
        .set('Authorization', bearer(adminToken))
        .field('outro', 'valor')
        .expect(400);
    });

    it('arquivo vazio: 400, sem gravar', async () => {
      const antes = storage.size();

      await enviar(adminToken, Buffer.alloc(0)).expect(400);

      expect(storage.size()).toBe(antes);
    });

    it.each([
      ['extensao proibida', 'virus.exe', 'application/pdf'],
      ['HTML', 'pagina.html', 'text/html'],
      ['SVG', 'imagem.svg', 'image/svg+xml'],
      ['script', 'script.js', 'text/javascript'],
      ['sem extensao', 'semextensao', 'application/pdf'],
      ['extensao dupla terminando em exe', 'contrato.pdf.exe', 'application/pdf'],
    ])('%s e recusado com 400', async (_caso, nome, contentType) => {
      const antes = storage.size();

      await enviar(adminToken, PDF, nome, contentType).expect(400);

      expect(storage.size()).toBe(antes);
    });

    it('MIME incoerente com a extensao: 400', async () => {
      await enviar(adminToken, PDF, 'contrato.pdf', 'text/html').expect(400);
    });

    it('application/octet-stream nao e curinga: 400', async () => {
      await enviar(adminToken, PDF, 'contrato.pdf', 'application/octet-stream').expect(400);
    });

    it('arquivo acima do limite: 413', async () => {
      // O limite do endpoint e `DOCUMENT_MAX_FILE_SIZE` (10 MB por padrao),
      // independente do limite global de 100 kB das rotas JSON.
      const grande = Buffer.alloc(11 * 1024 * 1024, 0x25);

      const resposta = await enviar(adminToken, grande, 'grande.pdf');

      expect(resposta.status).toBe(413);
    });

    it('o 413 nao expoe stack trace nem o conteudo enviado', async () => {
      const grande = Buffer.alloc(11 * 1024 * 1024, 0x41);

      const resposta = await enviar(adminToken, grande, 'grande.pdf');

      const corpo = JSON.stringify(resposta.body);
      expect(corpo).not.toMatch(/at |\.ts:|\.js:|node_modules/);
      expect(corpo).not.toContain('AAAA');
    });

    it('arquivo DENTRO do limite global de 100 kB da Fase A continua passando', async () => {
      // Prova que o limite de documentos e proprio do endpoint: 500 kB passaria
      // do limite global de corpo, e aqui e aceito.
      const meioMega = Buffer.alloc(500 * 1024, 0x25);

      const resposta = await enviar(adminToken, meioMega, 'medio.pdf').expect(201);

      expect((resposta.body as DocumentResponseDto).tamanho).toBe(meioMega.length);
    });

    describe('seguranca do nome', () => {
      it.each([
        ['../../etc/passwd.pdf', 'passwd.pdf'],
        ['..\\..\\windows\\system32.pdf', 'system32.pdf'],
        ['/absolute/caminho.pdf', 'caminho.pdf'],
        ['C:\\Windows\\arquivo.pdf', 'arquivo.pdf'],
      ])('o nome hostil %j nao escapa para o caminho fisico', async (nome, esperado) => {
        const documento = await enviar(adminToken, PDF, nome).expect(201);
        const corpo = documento.body as DocumentResponseDto;

        // O proprio `busboy` ja reduz o nome ao basename, descartando qualquer
        // componente de caminho - barreira a mais, antes da nossa. O metadado
        // guardado nao contem travessia alguma.
        expect(corpo.nomeOriginal).toBe(esperado);
        expect(corpo.nomeOriginal).not.toMatch(/[/\\]|\.\./);

        // E o conteudo continua acessivel pela chave do servidor.
        const baixado = await baixar(corpo.id).expect(200);
        expect(baixado.body as Buffer).toEqual(PDF);
      });

      it('nome com Unicode e aceito e preservado', async () => {
        const nome = 'Declaração de Imposto de Renda — João.pdf';

        const documento = await enviarOk(nome);

        expect(documento.nomeOriginal).toBe(nome);
      });

      it('nome acima do limite de bytes: 400', async () => {
        const nome = `${'ç'.repeat(200)}.pdf`;

        await enviar(adminToken, PDF, nome).expect(400);
      });

      it('nome com tentativa de injecao de cabecalho nao quebra o download', async () => {
        const documento = await enviarOk('arquivo;teste".pdf');

        const resposta = await baixar(documento.id).expect(200);
        const disposition = resposta.headers['content-disposition'];

        expect(disposition).not.toMatch(/[\r\n]/);
        expect(disposition.startsWith('attachment;')).toBe(true);
        expect(resposta.headers['x-injected']).toBeUndefined();
      });
    });

    it('o cliente nao consegue escolher a chave de storage', async () => {
      // Mesmo enviando campos extra com nome de chave, o servidor gera a dele.
      const antes = storage.size();

      await request(server())
        .post('/documents')
        .set('Authorization', bearer(adminToken))
        .field('storageKey', '../../chave-escolhida.bin')
        .field('storage_key', '/etc/passwd')
        .attach('arquivo', PDF, { filename: 'contrato.pdf', contentType: 'application/pdf' })
        .expect(201);

      expect(storage.size()).toBe(antes + 1);
      expect(storage.has('../../chave-escolhida.bin')).toBe(false);
      expect(storage.has('/etc/passwd')).toBe(false);
    });
  });

  describe('GET /documents', () => {
    it('lista paginado, do mais recente para o mais antigo', async () => {
      await enviarOk('primeiro.pdf');
      await enviarOk('segundo.pdf');

      const resposta = await request(server())
        .get('/documents')
        .query({ page: '1', limit: '2' })
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const pagina = resposta.body as DocumentPageResponseDto;

      expect(pagina.items).toHaveLength(2);
      expect(pagina.page).toBe(1);
      expect(pagina.limit).toBe(2);
      expect(pagina.total).toBeGreaterThanOrEqual(2);
    });

    it('a listagem NAO expoe chave de storage nem conteudo', async () => {
      await enviarOk();

      const resposta = await request(server())
        .get('/documents')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const serializado = JSON.stringify(resposta.body);
      expect(serializado).not.toMatch(/storageKey|storage_key|\.bin/);
      expect(serializado).not.toContain(PDF.toString('base64'));
    });

    it('nao aceita limit acima do maximo', async () => {
      await request(server())
        .get('/documents')
        .query({ limit: '999999' })
        .set('Authorization', bearer(adminToken))
        .expect(400);
    });

    it('nao aceita page zero nem negativa', async () => {
      for (const page of ['0', '-1']) {
        await request(server())
          .get('/documents')
          .query({ page })
          .set('Authorization', bearer(adminToken))
          .expect(400);
      }
    });

    it('parametro desconhecido: 400', async () => {
      await request(server())
        .get('/documents')
        .query({ criadoPorId: 'qualquer' })
        .set('Authorization', bearer(adminToken))
        .expect(400);
    });

    it('pagina sem registros devolve lista vazia, nao erro', async () => {
      const resposta = await request(server())
        .get('/documents')
        .query({ page: '9999', limit: '20' })
        .set('Authorization', bearer(adminToken))
        .expect(200);

      expect((resposta.body as DocumentPageResponseDto).items).toEqual([]);
    });

    it('listar NAO gera auditoria', async () => {
      const antes = (await registrosDeAuditoria(AuditAction.DocumentDownloaded)).length;

      await request(server())
        .get('/documents')
        .set('Authorization', bearer(adminToken))
        .expect(200);

      expect(await registrosDeAuditoria(AuditAction.DocumentDownloaded)).toHaveLength(antes);
    });
  });

  describe('GET /documents/:id/download', () => {
    it('devolve o conteudo exato que foi enviado', async () => {
      const conteudo = Buffer.from([0, 1, 2, 255, 254, 37, 80, 68, 70]);
      const enviado = await enviar(adminToken, conteudo, 'binario.pdf').expect(201);

      const resposta = await baixar((enviado.body as DocumentResponseDto).id).expect(200);

      expect(resposta.body as Buffer).toEqual(conteudo);
    });

    it('responde como ANEXO, com nosniff', async () => {
      const documento = await enviarOk();

      const resposta = await baixar(documento.id).expect(200);

      expect(resposta.headers['content-disposition']).toContain('attachment;');
      expect(resposta.headers['content-disposition']).not.toContain('inline');
      expect(resposta.headers['x-content-type-options']).toBe('nosniff');
      expect(resposta.headers['content-type']).toContain('application/pdf');
      expect(resposta.headers['content-length']).toBe(String(PDF.length));
    });

    it('o nome com acento vai no filename* em UTF-8', async () => {
      const documento = await enviarOk('Contrato João.pdf');

      const resposta = await baixar(documento.id).expect(200);

      expect(resposta.headers['content-disposition']).toContain("filename*=UTF-8''");
      expect(resposta.headers['content-disposition']).toContain('Jo%C3%A3o');
    });

    it('gera DOCUMENT_DOWNLOADED', async () => {
      const documento = await enviarOk();
      const antes = (await registrosDeAuditoria(AuditAction.DocumentDownloaded)).length;

      await baixar(documento.id).expect(200);

      const registros = await registrosDeAuditoria(AuditAction.DocumentDownloaded);
      expect(registros).toHaveLength(antes + 1);
      expect(JSON.stringify(registros)).toContain(documento.id);
    });

    it('a auditoria do download nao leva conteudo nem chave', async () => {
      const documento = await enviarOk();

      await baixar(documento.id).expect(200);

      const serializado = JSON.stringify(
        await registrosDeAuditoria(AuditAction.DocumentDownloaded),
      );
      expect(serializado).not.toContain(PDF.toString('base64'));
      expect(serializado).not.toMatch(/\.bin/);
    });

    it('documento inexistente: 404', async () => {
      await request(server())
        .get(`/documents/${UUID_INEXISTENTE}/download`)
        .set('Authorization', bearer(adminToken))
        .expect(404);
    });

    it('id que nao e UUID: 400', async () => {
      await request(server())
        .get('/documents/nao-e-uuid/download')
        .set('Authorization', bearer(adminToken))
        .expect(400);
    });

    it('404 e 400 nao geram auditoria de download', async () => {
      const antes = (await registrosDeAuditoria(AuditAction.DocumentDownloaded)).length;

      await request(server())
        .get(`/documents/${UUID_INEXISTENTE}/download`)
        .set('Authorization', bearer(adminToken))
        .expect(404);

      expect(await registrosDeAuditoria(AuditAction.DocumentDownloaded)).toHaveLength(antes);
    });

    it('404 nao revela se o objeto existe fisicamente', async () => {
      const resposta = await request(server())
        .get(`/documents/${UUID_INEXISTENTE}/download`)
        .set('Authorization', bearer(adminToken))
        .expect(404);

      const corpo = resposta.body as Record<string, unknown>;

      // O campo `path` do corpo e o caminho da REQUISICAO, formato padrao de
      // erro da aplicacao - o cliente ja o conhece. O que nao pode aparecer e
      // chave de storage, extensao fisica ou caminho de filesystem.
      expect(JSON.stringify(corpo)).not.toMatch(/\.bin|storageKey|storage_key/);
      expect(JSON.stringify(corpo)).not.toMatch(/[A-Za-z]:\|\/var\/|\/tmp\/|AppData/);
      expect(corpo.message).toBe('Documento nao encontrado');
    });
  });

  describe('inconsistencia entre banco e storage', () => {
    it('registro no banco sem objeto no storage: 500, nao 404', async () => {
      const documento = await enviarOk();
      const doBanco = await documentsRepository.findById(documento.id);
      // Simula o objeto desaparecido do storage.
      await storage.remove(doBanco?.storageKey ?? '');

      const resposta = await baixar(documento.id);

      // 404 esconderia uma inconsistencia que alguem precisa investigar.
      expect(resposta.status).toBe(500);
    });

    it('o 500 de inconsistencia nao vaza chave, caminho nem stack', async () => {
      const documento = await enviarOk();
      const doBanco = await documentsRepository.findById(documento.id);
      await storage.remove(doBanco?.storageKey ?? '');

      // Sem o parser binario: o erro vem como JSON, e e o corpo dele que
      // interessa aqui.
      const resposta = await request(server())
        .get(`/documents/${documento.id}/download`)
        .set('Authorization', bearer(adminToken))
        .expect(500);

      const corpo = resposta.body as Record<string, unknown>;
      expect(JSON.stringify(corpo)).not.toContain(doBanco?.storageKey ?? '!');
      expect(JSON.stringify(corpo)).not.toMatch(/at |\.ts:|\.js:|\.bin/);
      // Mantem o formato padrao de erro da aplicacao, com incidentId para
      // investigacao.
      expect(corpo.message).toBe('Erro interno do servidor');
      expect(typeof corpo.incidentId).toBe('string');
    });

    it('falha do banco depois de gravar: os bytes sao removidos', async () => {
      const antes = storage.size();
      const espiao = jest
        .spyOn(documentsRepository, 'create')
        .mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));
      try {
        const resposta = await enviar(adminToken, PDF, 'contrato.pdf');

        expect(resposta.status).toBe(500);
        // Rollback compensatorio: nenhum objeto orfao, nenhum registro.
        expect(storage.size()).toBe(antes);
      } finally {
        espiao.mockRestore();
      }
    });

    it('falha do banco nao deixa documento fantasma na listagem', async () => {
      const espiao = jest
        .spyOn(documentsRepository, 'create')
        .mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));
      try {
        await enviar(adminToken, PDF, 'fantasma.pdf');
      } finally {
        espiao.mockRestore();
      }

      const resposta = await request(server())
        .get('/documents')
        .query({ limit: '100' })
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const nomes = (resposta.body as DocumentPageResponseDto).items.map((item) => item.nome);
      expect(nomes).not.toContain('fantasma.pdf');
    });

    it('falha do banco nao gera DOCUMENT_CREATED', async () => {
      const antes = (await registrosDeAuditoria(AuditAction.DocumentCreated)).length;
      const espiao = jest
        .spyOn(documentsRepository, 'create')
        .mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));
      try {
        await enviar(adminToken, PDF, 'contrato.pdf');
      } finally {
        espiao.mockRestore();
      }

      expect(await registrosDeAuditoria(AuditAction.DocumentCreated)).toHaveLength(antes);
    });

    it('falha do storage nao deixa registro no banco', async () => {
      const espiao = jest
        .spyOn(storage, 'write')
        .mockRejectedValue(new Error('storage indisponivel'));
      try {
        const resposta = await enviar(adminToken, PDF, 'sem-storage.pdf');

        expect(resposta.status).toBe(500);
      } finally {
        espiao.mockRestore();
      }

      const resposta = await request(server())
        .get('/documents')
        .query({ limit: '100' })
        .set('Authorization', bearer(adminToken))
        .expect(200);

      const nomes = (resposta.body as DocumentPageResponseDto).items.map((item) => item.nome);
      expect(nomes).not.toContain('sem-storage.pdf');
    });

    it('falha do storage nao vaza detalhe na resposta', async () => {
      const espiao = jest
        .spyOn(storage, 'write')
        .mockRejectedValue(new Error('EACCES /var/storage/documents permission denied'));
      try {
        const resposta = await enviar(adminToken, PDF, 'contrato.pdf');

        const corpo = JSON.stringify(resposta.body);
        expect(corpo).not.toContain('/var/storage');
        expect(corpo).not.toContain('EACCES');
        expect(corpo).not.toMatch(/at |\.ts:|\.js:/);
      } finally {
        espiao.mockRestore();
      }
    });
  });

  describe('chave de storage unica', () => {
    it('duas chaves iguais sao recusadas pelo banco', async () => {
      const primeiro = await enviarOk();
      const doBanco = await documentsRepository.findById(primeiro.id);

      // Tenta criar outro registro apontando para o MESMO objeto fisico: sem a
      // constraint, uma remocao futura apagaria o conteudo de dois documentos.
      await expect(
        documentsRepository.create({
          nome: 'duplicado.pdf',
          nomeOriginal: 'duplicado.pdf',
          mimeType: 'application/pdf',
          tamanho: 10,
          storageKey: doBanco?.storageKey ?? '',
          criadoPorId: 'user-1',
        }),
      ).rejects.toThrow();
    });

    it('cada upload gera uma chave distinta', async () => {
      const antes = storage.size();

      await enviarOk('a.pdf');
      await enviarOk('b.pdf');
      await enviarOk('c.pdf');

      // Tres objetos, nao um sobrescrito tres vezes.
      expect(storage.size()).toBe(antes + 3);
    });
  });
});
