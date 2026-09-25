import { SETTING_CATALOG, SETTING_KEY_FORMAT } from './setting-catalog';
import { SETTING_KEY_MAX_LENGTH } from './entities/system-setting.entity';
import {
  parseSettingValue,
  serializeSettingValue,
  SETTING_VALUE_MAX_LENGTH,
} from './setting-value';

/**
 * O catalogo e semeado no boot, e uma entrada mal formada so apareceria em
 * producao. Estes testes seguram isso aqui.
 */
describe('SETTING_CATALOG', () => {
  it('tem pelo menos uma configuracao', () => {
    expect(SETTING_CATALOG.length).toBeGreaterThan(0);
  });

  it('nao repete chave', () => {
    const chaves = SETTING_CATALOG.map((definicao) => definicao.chave);

    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it.each(SETTING_CATALOG.map((definicao) => [definicao.chave, definicao] as const))(
    '%s esta bem definida',
    (_chave, definicao) => {
      expect(definicao.chave).toMatch(SETTING_KEY_FORMAT);
      expect(definicao.chave.length).toBeLessThanOrEqual(SETTING_KEY_MAX_LENGTH);
      expect(definicao.descricao.trim()).not.toBe('');

      // O valor padrao precisa obedecer as mesmas regras de um valor enviado
      // pela API - o seeder nao passa por validacao nenhuma.
      const parsed = parseSettingValue(definicao.tipo, definicao.padrao);
      expect(parsed).toEqual({ ok: true, value: definicao.padrao });
      expect(serializeSettingValue(definicao.padrao).length).toBeLessThanOrEqual(
        SETTING_VALUE_MAX_LENGTH,
      );
    },
  );

  /**
   * A tabela e explicitamente sem segredo: sem coluna `secret`, sem cifragem e
   * legivel por quem tem `settings:read`. Uma chave com cara de credencial nao
   * pode entrar por descuido.
   */
  it('nenhuma chave sugere credencial ou segredo', () => {
    const proibido = /SENHA|PASSWORD|TOKEN|SECRET|API_?KEY|CREDENTIAL|CERT|OAUTH|WEBHOOK/;

    expect(SETTING_CATALOG.filter((definicao) => proibido.test(definicao.chave))).toEqual([]);
  });
});
