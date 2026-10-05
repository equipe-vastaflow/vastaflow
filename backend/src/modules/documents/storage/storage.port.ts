import type { Readable } from 'node:stream';

/** Token de injecao do adapter de storage em uso. */
export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

/** Objeto lido do storage: o conteudo como stream, mais o tamanho em bytes. */
export interface StoredObject {
  readonly stream: Readable;
  readonly size: number;
}

/**
 * Contrato de armazenamento fisico de documentos.
 *
 * Tres operacoes, que sao as que esta fase usa: gravar, ler e remover. NAO tem
 * `list`, `copy`, `move`, `exists`, `signedUrl`, versionamento nem metadata
 * estendida - o projeto ja tem um caso de abstracao criada a frente da
 * necessidade que ninguem consome (`IntegrationRegistry`, um registrante e zero
 * consumidores), e a licao foi nao repetir isso. Operacao nova entra quando o
 * primeiro caso de uso dela existir.
 *
 * Nenhum tipo aqui vem de SDK de fornecedor: `Buffer`, `Readable` e `string`
 * sao do Node. E o que permite trocar o adapter sem tocar na entidade, no
 * service, nos controllers, no RBAC, na auditoria nem nas regras de validacao.
 *
 * A `storageKey` e SEMPRE gerada pelo servidor (`storage-key.ts`). O adapter
 * nao recebe nome de arquivo do usuario e nao decide onde o objeto mora.
 */
export interface StoragePort {
  /**
   * Grava o conteudo na chave informada.
   *
   * @throws StorageWriteError quando nao foi possivel gravar.
   */
  write(storageKey: string, content: Buffer): Promise<void>;

  /**
   * Abre o objeto para leitura.
   *
   * @throws StorageObjectNotFoundError quando a chave nao existe no storage.
   * @throws StorageReadError para qualquer outra falha de leitura.
   */
  read(storageKey: string): Promise<StoredObject>;

  /**
   * Remove o objeto. Remover chave inexistente NAO e erro: a operacao e
   * idempotente, porque quem a chama (o rollback do upload) nao tem como saber
   * se a escrita chegou a acontecer.
   */
  remove(storageKey: string): Promise<void>;
}

/** Chave ausente no storage. Distinta de falha de leitura, porque o tratamento difere. */
export class StorageObjectNotFoundError extends Error {
  constructor(readonly storageKey: string) {
    // A mensagem NAO leva caminho fisico nem bucket: ela pode chegar ao log, e
    // o que importa para investigar e a chave logica.
    super(`Objeto nao encontrado no storage: ${storageKey}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

export class StorageWriteError extends Error {
  constructor(readonly storageKey: string, readonly cause?: unknown) {
    super(`Falha ao gravar no storage: ${storageKey}`);
    this.name = 'StorageWriteError';
  }
}

export class StorageReadError extends Error {
  constructor(readonly storageKey: string, readonly cause?: unknown) {
    super(`Falha ao ler do storage: ${storageKey}`);
    this.name = 'StorageReadError';
  }
}

/** Chave que nao foi gerada por este sistema. Indica tentativa de manipulacao. */
export class UnsafeStorageKeyError extends Error {
  constructor() {
    // Sem repetir a chave recusada: ela e entrada hostil e nao deve ser
    // devolvida nem registrada em log.
    super('Chave de storage invalida');
    this.name = 'UnsafeStorageKeyError';
  }
}
