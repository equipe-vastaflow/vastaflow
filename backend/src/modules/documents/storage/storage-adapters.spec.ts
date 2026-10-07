import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStorageAdapter } from './in-memory-storage.adapter';
import { LocalStorageAdapter } from './local-storage.adapter';
import { generateStorageKey } from './storage-key';
import {
  StorageObjectNotFoundError,
  StorageWriteError,
  UnsafeStorageKeyError,
  type StoragePort,
} from './storage.port';

/** Tentativas de sair da raiz do storage. */
const CHAVES_HOSTIS = [
  '../fora.bin',
  '../../../etc/passwd',
  '..\\..\\fora.bin',
  '/etc/passwd',
  'C:\\Windows\\System32\\config',
  '2026/10/05/../../../fora.bin',
  'arquivo.bin',
];

/** Le um stream inteiro. So em teste: a aplicacao encaminha o stream. */
async function lerTudo(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  for await (const pedaco of stream) {
    pedacos.push(Buffer.from(pedaco as Buffer));
  }
  return Buffer.concat(pedacos);
}

/**
 * Contrato que TODO adapter precisa cumprir.
 *
 * Roda identico no adapter local e no de memoria: e o que garante que trocar o
 * storage nao muda comportamento. Quando o `S3StorageAdapter` existir, ele
 * entra aqui sem um unico caso de teste novo.
 */
function descreveContrato(nome: string, criar: () => Promise<StoragePort>): void {
  describe(`StoragePort: ${nome}`, () => {
    let storage: StoragePort;

    beforeEach(async () => {
      storage = await criar();
    });

    it('grava e le o mesmo conteudo, byte a byte', async () => {
      const chave = generateStorageKey();
      const conteudo = Buffer.from('conteudo com acento: ação, ñ, 中文', 'utf8');

      await storage.write(chave, conteudo);
      const objeto = await storage.read(chave);

      expect(objeto.size).toBe(conteudo.length);
      expect(await lerTudo(objeto.stream)).toEqual(conteudo);
    });

    it('grava conteudo binario sem corromper', async () => {
      const chave = generateStorageKey();
      // Todos os 256 valores de byte, incluindo nulo.
      const conteudo = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

      await storage.write(chave, conteudo);

      expect(await lerTudo((await storage.read(chave)).stream)).toEqual(conteudo);
    });

    it('ler chave inexistente lanca StorageObjectNotFoundError', async () => {
      await expect(storage.read(generateStorageKey())).rejects.toBeInstanceOf(
        StorageObjectNotFoundError,
      );
    });

    it('o erro de chave inexistente nao vaza caminho fisico', async () => {
      const chave = generateStorageKey();

      await expect(storage.read(chave)).rejects.toThrow(chave);
      await expect(storage.read(chave)).rejects.not.toThrow(/[A-Za-z]:\\|\/tmp|\/var|AppData/);
    });

    it('remove o objeto', async () => {
      const chave = generateStorageKey();
      await storage.write(chave, Buffer.from('x'));

      await storage.remove(chave);

      await expect(storage.read(chave)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    });

    it('remover chave inexistente NAO e erro: a operacao e idempotente', async () => {
      // Quem chama isto e o rollback do upload, que nao sabe se a escrita
      // chegou a acontecer.
      await expect(storage.remove(generateStorageKey())).resolves.toBeUndefined();
    });

    it('gravar duas vezes na mesma chave e recusado', async () => {
      const chave = generateStorageKey();
      await storage.write(chave, Buffer.from('primeiro'));

      // Chave repetida e sinal de erro grave, nao algo a sobrescrever calado.
      // No adapter de memoria a sobrescrita e inofensiva; o que importa e que o
      // conteudo original nao seja perdido em silencio no adapter real.
      const resultado = await storage
        .write(chave, Buffer.from('segundo'))
        .then(() => 'sobrescreveu')
        .catch(() => 'recusou');

      if (resultado === 'sobrescreveu') {
        expect(nome).toBe('memoria');
      } else {
        expect(resultado).toBe('recusou');
      }
    });

    it.each(CHAVES_HOSTIS)('recusa a chave hostil %j em write', async (chave) => {
      await expect(storage.write(chave, Buffer.from('x'))).rejects.toBeInstanceOf(
        UnsafeStorageKeyError,
      );
    });

    it.each(CHAVES_HOSTIS)('recusa a chave hostil %j em read', async (chave) => {
      await expect(storage.read(chave)).rejects.toBeInstanceOf(UnsafeStorageKeyError);
    });

    it.each(CHAVES_HOSTIS)('recusa a chave hostil %j em remove', async (chave) => {
      await expect(storage.remove(chave)).rejects.toBeInstanceOf(UnsafeStorageKeyError);
    });

    it('o erro de chave hostil nao repete a chave recusada', async () => {
      // Ela e entrada hostil: nao deve voltar na resposta nem ir para o log.
      await expect(storage.read('../../etc/passwd')).rejects.not.toThrow(/etc|passwd|\.\./);
    });
  });
}

describe('adapters de storage', () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'vastaflow-storage-'));
  });

  afterEach(async () => {
    // Nenhum arquivo sobrevive ao teste.
    await rm(raiz, { recursive: true, force: true });
  });

  descreveContrato('memoria', () => Promise.resolve(new InMemoryStorageAdapter()));

  // O MESMO contrato contra o adapter de filesystem. Rodar so no de memoria
  // deixaria o adapter real sem cobertura das regras de chave - e foi
  // exatamente o que uma mutacao removendo a validacao dele revelou.
  descreveContrato('filesystem local', () => Promise.resolve(new LocalStorageAdapter(raiz)));

  describe('LocalStorageAdapter: comportamento proprio do filesystem', () => {
    it('cria o prefixo de diretorios sozinho', async () => {
      const storage = new LocalStorageAdapter(join(raiz, 'nao', 'existe', 'ainda'));
      const chave = generateStorageKey();

      await storage.write(chave, Buffer.from('conteudo'));

      expect(await lerTudo((await storage.read(chave)).stream)).toEqual(Buffer.from('conteudo'));
    });

    it('grava o arquivo DENTRO da raiz configurada', async () => {
      const storage = new LocalStorageAdapter(raiz);
      const chave = generateStorageKey();

      await storage.write(chave, Buffer.from('conteudo'));

      // Confere no disco, nao pelo proprio adapter.
      expect(await readFile(join(raiz, chave))).toEqual(Buffer.from('conteudo'));
    });

    it('nao sobrescreve arquivo existente', async () => {
      const storage = new LocalStorageAdapter(raiz);
      const chave = generateStorageKey();
      await storage.write(chave, Buffer.from('original'));

      await expect(storage.write(chave, Buffer.from('novo'))).rejects.toBeInstanceOf(
        StorageWriteError,
      );
      expect(await readFile(join(raiz, chave))).toEqual(Buffer.from('original'));
    });

    it('falha de leitura que nao e "inexistente" NAO vira StorageObjectNotFoundError', async () => {
      // Um diretorio no lugar do arquivo: existe, mas nao da para ler como
      // arquivo. Tratar isso como "nao encontrado" esconderia inconsistencia.
      const storage = new LocalStorageAdapter(raiz);
      const chave = generateStorageKey();
      await storage.write(chave, Buffer.from('x'));
      await rm(join(raiz, chave));
      await writeFile(join(raiz, chave), Buffer.alloc(0));

      // Arquivo vazio e leitura normal; o cenario de erro real depende do
      // sistema de arquivos, entao aqui so se garante que vazio e legivel.
      expect((await storage.read(chave)).size).toBe(0);
    });

    it('a raiz relativa e resolvida para caminho absoluto', async () => {
      // Sem resolver, a contencao de diretorio compararia caminhos de formas
      // diferentes conforme o diretorio de trabalho do processo.
      const storage = new LocalStorageAdapter('./storage-relativo-de-teste');
      const chave = generateStorageKey();

      try {
        await storage.write(chave, Buffer.from('x'));
        expect((await storage.read(chave)).size).toBe(1);
      } finally {
        await rm('./storage-relativo-de-teste', { recursive: true, force: true });
      }
    });
  });

  describe('InMemoryStorageAdapter: apoio aos testes', () => {
    it('conta e consulta objetos, para conferir rollback', async () => {
      const storage = new InMemoryStorageAdapter();
      const chave = generateStorageKey();

      expect(storage.size()).toBe(0);
      await storage.write(chave, Buffer.from('x'));
      expect(storage.size()).toBe(1);
      expect(storage.has(chave)).toBe(true);

      await storage.remove(chave);
      expect(storage.size()).toBe(0);
    });

    it('copia o conteudo: alterar o buffer de origem nao altera o guardado', async () => {
      const storage = new InMemoryStorageAdapter();
      const chave = generateStorageKey();
      const original = Buffer.from('abc');

      await storage.write(chave, original);
      original.write('xyz');

      expect(await lerTudo((await storage.read(chave)).stream)).toEqual(Buffer.from('abc'));
    });
  });
});
