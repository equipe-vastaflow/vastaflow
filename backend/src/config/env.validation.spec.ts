import { DatabaseType, Environment, validateEnv } from './env.validation';

/** Variaveis obrigatorias sem valor padrao; cada teste sobrescreve o que quer exercitar. */
const baseEnv = {
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'vastaflow',
  DATABASE_USER: 'vastaflow',
  DATABASE_PASSWORD: 'senha-de-teste',
};

describe('validateEnv', () => {
  it('aplica os padroes quando so as variaveis obrigatorias sao informadas', () => {
    expect(validateEnv(baseEnv)).toMatchObject({
      NODE_ENV: Environment.Development,
      PORT: 3000,
      APP_NAME: 'vasta-flow',
      SWAGGER_ENABLED: true,
      DATABASE_TYPE: DatabaseType.Mysql,
      DATABASE_SYNCHRONIZE: false,
      JWT_EXPIRES_IN: '1h',
      BCRYPT_SALT_ROUNDS: 12,
      FRONTEND_ORIGIN: '',
      SEED_ADMIN_NAME: 'Administrador',
    });
  });

  it('converte PORT de string para numero', () => {
    expect(validateEnv({ ...baseEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it("interpreta SWAGGER_ENABLED='false' como booleano false", () => {
    expect(validateEnv({ ...baseEnv, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });

  it('rejeita NODE_ENV fora dos valores suportados', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'homologacao' })).toThrow(/NODE_ENV/);
  });

  it('rejeita PORT fora da faixa valida', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejeita PORT nao numerico', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('trata APP_NAME em branco como nao informado', () => {
    expect(validateEnv({ ...baseEnv, APP_NAME: '   ' }).APP_NAME).toBe('vasta-flow');
  });

  it('remove espacos ao redor de APP_NAME', () => {
    expect(validateEnv({ ...baseEnv, APP_NAME: '  vasta-flow-homolog  ' }).APP_NAME).toBe(
      'vasta-flow-homolog',
    );
  });

  it('aponta o arquivo .env na mensagem de erro', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'invalido' })).toThrow(/\.env\.example/);
  });

  describe('autenticacao', () => {
    it('exige JWT_SECRET', () => {
      expect(() => validateEnv({ ...baseEnv, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
    });

    it('rejeita JWT_SECRET curto', () => {
      expect(() => validateEnv({ ...baseEnv, JWT_SECRET: 'curto' })).toThrow(/JWT_SECRET/);
    });

    it('rejeita JWT_EXPIRES_IN fora do formato esperado', () => {
      expect(() => validateEnv({ ...baseEnv, JWT_EXPIRES_IN: 'uma hora' })).toThrow(
        /JWT_EXPIRES_IN/,
      );
    });

    it('rejeita BCRYPT_SALT_ROUNDS fora da faixa', () => {
      expect(() => validateEnv({ ...baseEnv, BCRYPT_SALT_ROUNDS: '2' })).toThrow(
        /BCRYPT_SALT_ROUNDS/,
      );
    });
  });

  describe('banco de dados', () => {
    it('exige credenciais quando nao ha DATABASE_URL', () => {
      expect(() => validateEnv({ JWT_SECRET: baseEnv.JWT_SECRET })).toThrow(/DATABASE_HOST/);
    });

    it('dispensa HOST/NAME/USER/PASSWORD quando DATABASE_URL esta presente', () => {
      const env = validateEnv({
        JWT_SECRET: baseEnv.JWT_SECRET,
        DATABASE_URL: 'mysql://u:p@localhost:3306/vastaflow',
      });
      expect(env.DATABASE_URL).toBe('mysql://u:p@localhost:3306/vastaflow');
    });

    it('rejeita DATABASE_TYPE desconhecido', () => {
      expect(() => validateEnv({ ...baseEnv, DATABASE_TYPE: 'postgres' })).toThrow(/DATABASE_TYPE/);
    });

    it('exige exatamente um entre SID e SERVICE_NAME no Oracle', () => {
      const oracle = { ...baseEnv, DATABASE_TYPE: 'oracle' };
      expect(() => validateEnv(oracle)).toThrow(/SID/);
      expect(() =>
        validateEnv({ ...oracle, DATABASE_ORACLE_SID: 'a', DATABASE_ORACLE_SERVICE_NAME: 'b' }),
      ).toThrow(/SID/);
      expect(validateEnv({ ...oracle, DATABASE_ORACLE_SID: 'ORCL' }).DATABASE_ORACLE_SID).toBe(
        'ORCL',
      );
    });

    it('proibe DATABASE_SYNCHRONIZE em producao', () => {
      expect(() =>
        validateEnv({ ...baseEnv, NODE_ENV: 'production', DATABASE_SYNCHRONIZE: 'true' }),
      ).toThrow(/DATABASE_SYNCHRONIZE/);
      expect(
        validateEnv({ ...baseEnv, NODE_ENV: 'development', DATABASE_SYNCHRONIZE: 'true' })
          .DATABASE_SYNCHRONIZE,
      ).toBe(true);
    });
  });

  describe('administrador inicial', () => {
    it('exige e-mail e senha juntos', () => {
      expect(() => validateEnv({ ...baseEnv, SEED_ADMIN_EMAIL: 'admin@vasta.com' })).toThrow(
        /SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD/,
      );
    });

    it('aceita o par completo', () => {
      const env = validateEnv({
        ...baseEnv,
        SEED_ADMIN_EMAIL: 'admin@vasta.com',
        SEED_ADMIN_PASSWORD: 'Senha@1234',
      });
      expect(env.SEED_ADMIN_EMAIL).toBe('admin@vasta.com');
    });
  });
});
