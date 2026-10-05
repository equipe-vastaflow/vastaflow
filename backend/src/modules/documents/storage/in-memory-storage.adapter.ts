import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { isSafeStorageKey } from './storage-key';
import {
  StorageObjectNotFoundError,
  UnsafeStorageKeyError,
  type StoragePort,
  type StoredObject,
} from './storage.port';

/**
 * Storage em memoria, para testes.
 *
 * Implementa a MESMA `StoragePort`, sem nenhuma regra de negocio propria: o que
 * valida arquivo, gera chave, audita e decide permissao esta no service, e e o
 * mesmo codigo exercitado em producao. Trocar o adapter nao troca o
 * comportamento testado - troca apenas onde os bytes ficam.
 *
 * Existe para os e2e nao escreverem arquivo de verdade: o banco de teste ja e
 * `sql.js` em memoria, e deixar o storage em disco criaria lixo entre execucoes
 * e dependencia de permissao de escrita.
 *
 * A validacao da chave e repetida aqui de proposito. Se so o adapter local
 * recusasse chave insegura, um teste de travessia passaria por acidente - e o
 * teste estaria medindo o adapter, nao a regra.
 */
@Injectable()
export class InMemoryStorageAdapter implements StoragePort {
  private readonly objects = new Map<string, Buffer>();

  write(storageKey: string, content: Buffer): Promise<void> {
    this.assertSafe(storageKey);
    // Copia o buffer: quem chamou pode reaproveitar o dele.
    this.objects.set(storageKey, Buffer.from(content));
    return Promise.resolve();
  }

  read(storageKey: string): Promise<StoredObject> {
    this.assertSafe(storageKey);
    const conteudo = this.objects.get(storageKey);
    if (!conteudo) {
      return Promise.reject(new StorageObjectNotFoundError(storageKey));
    }
    return Promise.resolve({ stream: Readable.from(conteudo), size: conteudo.length });
  }

  remove(storageKey: string): Promise<void> {
    this.assertSafe(storageKey);
    // Idempotente, como manda o contrato.
    this.objects.delete(storageKey);
    return Promise.resolve();
  }

  /** Quantos objetos existem. Usado SOMENTE por teste, para conferir rollback. */
  size(): number {
    return this.objects.size;
  }

  /** `true` se a chave existe. Usado SOMENTE por teste. */
  has(storageKey: string): boolean {
    return this.objects.has(storageKey);
  }

  private assertSafe(storageKey: string): void {
    if (!isSafeStorageKey(storageKey)) {
      throw new UnsafeStorageKeyError();
    }
  }
}
