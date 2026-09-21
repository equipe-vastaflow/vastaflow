import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import type { EnvironmentVariables } from '../../config/env.validation';

/**
 * Hash e verificacao de senhas (bcrypt). Nenhuma senha em texto puro e
 * armazenada ou registrada em log.
 */
@Injectable()
export class PasswordService {
  private readonly saltRounds: number;
  private dummyHash?: Promise<string>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.saltRounds = config.get('BCRYPT_SALT_ROUNDS', { infer: true });
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.saltRounds);
  }

  /**
   * Compara a senha com o hash. Quando `hash` e `undefined` (usuario
   * inexistente) compara contra um hash descartavel e devolve `false`: o tempo
   * de resposta fica igual ao de uma senha errada e o login nao revela quais
   * e-mails estao cadastrados.
   */
  async verify(plain: string, hash: string | undefined): Promise<boolean> {
    if (hash === undefined) {
      this.dummyHash ??= this.hash(randomUUID());
      await bcrypt.compare(plain, await this.dummyHash);
      return false;
    }
    return bcrypt.compare(plain, hash);
  }
}
