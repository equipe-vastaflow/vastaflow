import { Injectable, NotFoundException } from '@nestjs/common';
import { readSettingValue, type SettingValue } from './setting-value';
import { SettingsRepository } from './settings.repository';
import { SystemSettingType } from './system-setting.enums';

/**
 * Leitura tipada de configuracao, para os demais modulos.
 *
 * E o unico caminho que outro modulo deve usar: ninguem le a tabela
 * `system_settings` direto nem repete a conversao de texto para tipo. Nao ha
 * chamada HTTP interna - e uma consulta ao banco, no mesmo processo.
 *
 * SEM CACHE, por decisao desta etapa: a tabela tem poucas linhas, nenhum modulo
 * a consulta em caminho quente ainda, e um cache em memoria traria um contrato
 * de invalidacao que nao vale o risco agora - com mais de uma instancia da
 * aplicacao, cada uma teria a sua copia e um PATCH so atualizaria a instancia
 * que o atendeu. Enquanto for consulta direta, `GET` e `PATCH` nunca divergem.
 * Quando houver leitura frequente o suficiente para justificar, o cache entra
 * AQUI - e so aqui -, invalidado pelo `SettingsService.update`.
 */
@Injectable()
export class SystemSettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  /**
   * Valor ja convertido para o tipo declarado da configuracao.
   *
   * @throws NotFoundException chave fora do catalogo (ou ainda nao semeada).
   */
  async get(chave: string): Promise<SettingValue> {
    const setting = await this.repository.findByKey(chave);
    if (!setting) {
      throw new NotFoundException(`Configuracao ${chave} nao encontrada`);
    }
    return readSettingValue(setting.tipo, setting.valor);
  }

  async getString(chave: string): Promise<string> {
    const value = await this.getTyped(chave, SystemSettingType.String);
    if (typeof value !== 'string') {
      throw new Error(`Configuracao ${chave} nao e um texto`);
    }
    return value;
  }

  async getNumber(chave: string): Promise<number> {
    const value = await this.getTyped(chave, SystemSettingType.Number);
    if (typeof value !== 'number') {
      throw new Error(`Configuracao ${chave} nao e um numero`);
    }
    return value;
  }

  async getBoolean(chave: string): Promise<boolean> {
    const value = await this.getTyped(chave, SystemSettingType.Boolean);
    if (typeof value !== 'boolean') {
      throw new Error(`Configuracao ${chave} nao e um booleano`);
    }
    return value;
  }

  /**
   * Le a configuracao exigindo o tipo esperado.
   *
   * Pedir `getNumber` de uma chave STRING e erro de programacao, nao entrada do
   * usuario: falha alto em vez de devolver um valor convertido as pressas.
   */
  private async getTyped(chave: string, esperado: SystemSettingType): Promise<SettingValue> {
    const setting = await this.repository.findByKey(chave);
    if (!setting) {
      throw new NotFoundException(`Configuracao ${chave} nao encontrada`);
    }
    if (setting.tipo !== esperado) {
      throw new Error(`Configuracao ${chave} e ${setting.tipo}, nao ${esperado}`);
    }
    return readSettingValue(setting.tipo, setting.valor);
  }
}
