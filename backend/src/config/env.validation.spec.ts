import { Environment, validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('aplica os padroes quando nenhuma variavel e informada', () => {
    expect(validateEnv({})).toMatchObject({
      NODE_ENV: Environment.Development,
      PORT: 3000,
      APP_NAME: 'vasta-flow',
      SWAGGER_ENABLED: true,
    });
  });

  it('converte PORT de string para numero', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it("interpreta SWAGGER_ENABLED='false' como booleano false", () => {
    expect(validateEnv({ SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });

  it('rejeita NODE_ENV fora dos valores suportados', () => {
    expect(() => validateEnv({ NODE_ENV: 'homologacao' })).toThrow(/NODE_ENV/);
  });

  it('rejeita PORT fora da faixa valida', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejeita PORT nao numerico', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('trata APP_NAME em branco como nao informado', () => {
    expect(validateEnv({ APP_NAME: '   ' }).APP_NAME).toBe('vasta-flow');
  });

  it('remove espacos ao redor de APP_NAME', () => {
    expect(validateEnv({ APP_NAME: '  vasta-flow-homolog  ' }).APP_NAME).toBe('vasta-flow-homolog');
  });

  it('aponta o arquivo .env na mensagem de erro', () => {
    expect(() => validateEnv({ NODE_ENV: 'invalido' })).toThrow(/\.env\.example/);
  });
});
