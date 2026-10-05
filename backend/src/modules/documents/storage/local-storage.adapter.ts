import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { isSafeStorageKey } from './storage-key';
import {
  StorageObjectNotFoundError,
  StorageReadError,
  StorageWriteError,
  UnsafeStorageKeyError,
  type StoragePort,
  type StoredObject,
} from './storage.port';

/** Codigo do erro de "arquivo ou diretorio inexistente" no Node. */
const NOT_FOUND = 'ENOENT';

/**
 * Storage em filesystem local, para desenvolvimento.
 *
 * UNICO arquivo da aplicacao que conhece filesystem - e isso e o ponto da
 * `StoragePort`. Nenhum service, controller, DTO ou entity importa `node:fs`;
 * trocar este adapter pelo de S3 nao toca em nada deles.
 *
 * Duas barreiras contra travessia de diretorio, de proposito:
 *
 * 1. a chave e validada contra o formato exato que o servidor gera
 *    (`isSafeStorageKey`), que e lista branca;
 * 2. o caminho resolvido e conferido contra a raiz configurada.
 *
 * A segunda e redundante hoje, porque nada que passe pela primeira consegue
 * sair da raiz. Fica porque e barata e porque este e o unico ponto do sistema
 * onde um erro vira leitura ou escrita de arquivo arbitrario no servidor.
 */
@Injectable()
export class LocalStorageAdapter implements StoragePort {
  /** Raiz absoluta, resolvida uma vez: a comparacao de contencao depende disso. */
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async write(storageKey: string, content: Buffer): Promise<void> {
    const caminho = this.resolveSafe(storageKey);
    try {
      // `recursive` cria o prefixo de data e nao reclama se ja existir.
      await mkdir(dirname(caminho), { recursive: true });
      // `wx` falha se o arquivo existir: uma chave repetida e sinal de erro
      // grave (colisao de UUID ou reuso indevido), nao algo a sobrescrever em
      // silencio.
      await writeFile(caminho, content, { flag: 'wx' });
    } catch (error) {
      throw new StorageWriteError(storageKey, error);
    }
  }

  async read(storageKey: string): Promise<StoredObject> {
    const caminho = this.resolveSafe(storageKey);

    let tamanho: number;
    try {
      // `stat` antes de abrir para distinguir "nao existe" de "falhou ao ler",
      // e para informar o tamanho sem carregar o conteudo na memoria.
      tamanho = (await stat(caminho)).size;
    } catch (error) {
      if (isNotFound(error)) {
        throw new StorageObjectNotFoundError(storageKey);
      }
      throw new StorageReadError(storageKey, error);
    }

    return { stream: createReadStream(caminho), size: tamanho };
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolveSafe(storageKey));
    } catch (error) {
      // Idempotente: quem chama isto e o rollback do upload, que nao sabe se a
      // escrita chegou a acontecer.
      if (!isNotFound(error)) {
        throw new StorageWriteError(storageKey, error);
      }
    }
  }

  /**
   * Caminho absoluto da chave, recusando qualquer coisa fora da raiz.
   *
   * @throws UnsafeStorageKeyError
   */
  private resolveSafe(storageKey: string): string {
    if (!isSafeStorageKey(storageKey)) {
      throw new UnsafeStorageKeyError();
    }

    const caminho = resolve(join(this.root, storageKey));
    if (caminho !== this.root && !caminho.startsWith(this.root + sep)) {
      throw new UnsafeStorageKeyError();
    }
    return caminho;
  }
}

/** Reconhece o erro de caminho inexistente sem assumir a forma do objeto de erro. */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === NOT_FOUND
  );
}
