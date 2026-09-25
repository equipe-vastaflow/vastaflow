import { NotFoundException } from '@nestjs/common';
import type { SystemSetting } from './entities/system-setting.entity';
import { SettingsRepository } from './settings.repository';
import { SystemSettingType } from './system-setting.enums';
import { SystemSettingsService } from './system-settings.service';

function setting(overrides: Partial<SystemSetting> = {}): SystemSetting {
  return {
    id: 'setting-1',
    chave: 'SYSTEM_NAME',
    valor: 'VastaFlow',
    descricao: 'Nome do sistema',
    tipo: SystemSettingType.String,
    atualizadoPorId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const NUMERICA = setting({ chave: 'LIMITE', valor: '20', tipo: SystemSettingType.Number });
const BOOLEANA = setting({ chave: 'ATIVO', valor: 'true', tipo: SystemSettingType.Boolean });

/**
 * Camada que os demais modulos usarao para ler configuracao. Hoje nenhum modulo
 * a consome ainda - o contrato esta coberto aqui para que o primeiro consumidor
 * nao precise inventar nada.
 */
describe('SystemSettingsService', () => {
  let repository: jest.Mocked<Pick<SettingsRepository, 'findByKey'>>;
  let service: SystemSettingsService;

  beforeEach(() => {
    repository = { findByKey: jest.fn().mockResolvedValue(setting()) };
    service = new SystemSettingsService(repository as unknown as SettingsRepository);
  });

  describe('get', () => {
    it.each([
      ['STRING', setting(), 'VastaFlow'],
      ['NUMBER', NUMERICA, 20],
      ['BOOLEAN', BOOLEANA, true],
    ])('devolve o valor de uma configuracao %s ja convertido', async (_nome, linha, esperado) => {
      repository.findByKey.mockResolvedValue(linha);

      expect(await service.get(linha.chave)).toBe(esperado);
    });

    it('chave inexistente: NotFoundException', async () => {
      repository.findByKey.mockResolvedValue(null);

      await expect(service.get('NAO_EXISTE')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('leitura tipada', () => {
    it('getString devolve texto', async () => {
      expect(await service.getString('SYSTEM_NAME')).toBe('VastaFlow');
    });

    it('getNumber devolve numero, nao string', async () => {
      repository.findByKey.mockResolvedValue(NUMERICA);

      const valor = await service.getNumber('LIMITE');

      expect(valor).toBe(20);
      expect(typeof valor).toBe('number');
    });

    it('getBoolean devolve booleano, nao a string "true"', async () => {
      repository.findByKey.mockResolvedValue(BOOLEANA);

      const valor = await service.getBoolean('ATIVO');

      expect(valor).toBe(true);
      expect(typeof valor).toBe('boolean');
    });

    it('getBoolean de uma configuracao gravada como "false" devolve false', async () => {
      repository.findByKey.mockResolvedValue(
        setting({ valor: 'false', tipo: SystemSettingType.Boolean }),
      );

      expect(await service.getBoolean('SYSTEM_NAME')).toBe(false);
    });

    /**
     * Pedir o tipo errado e erro de programacao, nao entrada do usuario: falha
     * alto em vez de devolver um valor convertido as pressas.
     */
    it.each([
      ['getNumber de uma chave STRING', (s: SystemSettingsService) => s.getNumber('SYSTEM_NAME')],
      ['getBoolean de uma chave STRING', (s: SystemSettingsService) => s.getBoolean('SYSTEM_NAME')],
    ])('%s falha', async (_nome, operacao) => {
      await expect(operacao(service)).rejects.toThrow(/e STRING, nao/);
    });

    it.each([
      ['getString', (s: SystemSettingsService) => s.getString('NAO_EXISTE')],
      ['getNumber', (s: SystemSettingsService) => s.getNumber('NAO_EXISTE')],
      ['getBoolean', (s: SystemSettingsService) => s.getBoolean('NAO_EXISTE')],
    ])('%s de chave inexistente: NotFoundException', async (_nome, operacao) => {
      repository.findByKey.mockResolvedValue(null);

      await expect(operacao(service)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * Nesta etapa nao ha cache: cada leitura vai ao banco. E o que garante que um
   * PATCH nunca deixe um valor antigo em circulacao. Quando um cache entrar,
   * ele entra AQUI - e este teste muda junto, de proposito.
   */
  it('le do banco a cada chamada: nenhum valor antigo fica em circulacao', async () => {
    await service.get('SYSTEM_NAME');
    repository.findByKey.mockResolvedValue(setting({ valor: 'Outro' }));

    expect(await service.get('SYSTEM_NAME')).toBe('Outro');
    expect(repository.findByKey).toHaveBeenCalledTimes(2);
  });
});
