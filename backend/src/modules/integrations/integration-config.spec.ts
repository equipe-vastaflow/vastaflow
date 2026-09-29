import { ConfigService } from '@nestjs/config';
import { hasConfigValues } from './integration-config';

/** Chaves de TESTE: nenhuma delas existe no `.env.example`. */
const TOKEN = 'TESTE_INTEGRACAO_TOKEN';
const URL_BASE = 'TESTE_INTEGRACAO_URL';

describe('hasConfigValues', () => {
  it('todas as chaves com valor: true', () => {
    const config = new ConfigService({ [TOKEN]: 'abc', [URL_BASE]: 'https://exemplo.test' });

    expect(hasConfigValues(config, [TOKEN, URL_BASE])).toBe(true);
  });

  it('uma chave ausente: false', () => {
    expect(hasConfigValues(new ConfigService({ [TOKEN]: 'abc' }), [TOKEN, URL_BASE])).toBe(false);
  });

  it.each([
    ['texto vazio', ''],
    ['so espacos', '   '],
    ['nulo', null],
  ])('valor %s conta como nao configurado', (_caso, valor) => {
    expect(hasConfigValues(new ConfigService({ [TOKEN]: valor }), [TOKEN])).toBe(false);
  });

  it('valor nao textual presente conta como configurado', () => {
    expect(hasConfigValues(new ConfigService({ [TOKEN]: 0 }), [TOKEN])).toBe(true);
  });

  it('sem chaves exigidas: configurado', () => {
    expect(hasConfigValues(new ConfigService({}), [])).toBe(true);
  });

  it('devolve somente um booleano, nunca o valor', () => {
    const resultado = hasConfigValues(new ConfigService({ [TOKEN]: 'segredo' }), [TOKEN]);

    expect(typeof resultado).toBe('boolean');
  });
});
