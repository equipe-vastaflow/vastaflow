import { DatabaseType } from '../config/env.validation';
import { buildDataSourceOptions, type DatabaseEnvironment } from './database.config';

const baseEnv: DatabaseEnvironment = {
  DATABASE_TYPE: DatabaseType.Mysql,
  DATABASE_URL: undefined,
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: undefined,
  DATABASE_NAME: 'vastaflow',
  DATABASE_USER: 'vastaflow',
  DATABASE_PASSWORD: 'senha-de-teste',
  DATABASE_ORACLE_SID: undefined,
  DATABASE_ORACLE_SERVICE_NAME: undefined,
  DATABASE_SYNCHRONIZE: false,
  DATABASE_SSL: false,
  DATABASE_SSL_CA: undefined,
};

/** Le a opcao `ssl` sem assumir que ela existe no tipo da uniao. */
const sslDe = (env: DatabaseEnvironment): unknown =>
  (buildDataSourceOptions(env) as { ssl?: unknown }).ssl;

describe('buildDataSourceOptions', () => {
  describe('TLS do MySQL', () => {
    it('sem DATABASE_SSL a opcao ssl nao e sequer definida', () => {
      const options = buildDataSourceOptions(baseEnv);

      expect('ssl' in options).toBe(false);
    });

    it('com DATABASE_SSL e sem CA usa o pacote de CAs do proprio driver', () => {
      // Evita certificado no repositorio e arquivo para montar no servidor.
      expect(sslDe({ ...baseEnv, DATABASE_SSL: true })).toBe('Amazon RDS');
    });

    it('com CA informada usa exatamente aquela CA', () => {
      const ca = '-----BEGIN CERTIFICATE-----\nconteudo\n-----END CERTIFICATE-----';

      expect(sslDe({ ...baseEnv, DATABASE_SSL: true, DATABASE_SSL_CA: ca })).toEqual({
        ca,
        rejectUnauthorized: true,
      });
    });

    it('a verificacao do certificado NUNCA e desligada', () => {
      // O ponto central: TLS sem verificar a identidade do servidor protege
      // contra escuta passiva, nao contra um intermediario ativo.
      for (const ca of [undefined, 'pem-qualquer']) {
        const ssl = sslDe({ ...baseEnv, DATABASE_SSL: true, DATABASE_SSL_CA: ca });

        expect(JSON.stringify(ssl ?? null)).not.toContain('rejectUnauthorized":false');
      }
    });

    it('a CA informada nao vaza para nenhum outro campo da configuracao', () => {
      const ca = 'CA-SECRETA-DE-TESTE';
      const options = buildDataSourceOptions({
        ...baseEnv,
        DATABASE_SSL: true,
        DATABASE_SSL_CA: ca,
      });
      const { ssl, ...resto } = options as unknown as { ssl?: unknown } & Record<string, unknown>;

      expect(ssl).toBeDefined();
      expect(JSON.stringify(resto)).not.toContain(ca);
    });

    it('TLS vale tambem quando a conexao vem por DATABASE_URL', () => {
      // O deploy pode usar a URL em vez dos campos separados; o TLS nao pode
      // depender dessa escolha.
      const options = buildDataSourceOptions({
        ...baseEnv,
        DATABASE_URL: 'mysql://usuario:senha@host:3306/vastaflow',
        DATABASE_SSL: true,
      });

      expect((options as { ssl?: unknown }).ssl).toBe('Amazon RDS');
      expect((options as { url?: string }).url).toBeDefined();
    });

    it('nao altera charset nem timezone', () => {
      const options = buildDataSourceOptions({ ...baseEnv, DATABASE_SSL: true }) as {
        charset?: string;
        timezone?: string;
      };

      expect(options.charset).toBe('utf8mb4');
      expect(options.timezone).toBe('Z');
    });
  });

  describe('Oracle', () => {
    const oracleEnv: DatabaseEnvironment = {
      ...baseEnv,
      DATABASE_TYPE: DatabaseType.Oracle,
      DATABASE_ORACLE_SERVICE_NAME: 'VASTA',
    };

    it('nao recebe a opcao ssl do MySQL, nem com DATABASE_SSL ligado', () => {
      // O TLS do Oracle e configurado na string de conexao do proprio driver;
      // passar a opcao do mysql2 aqui nao teria efeito e confundiria.
      const options = buildDataSourceOptions({ ...oracleEnv, DATABASE_SSL: true });

      expect('ssl' in options).toBe(false);
      expect(options.type).toBe('oracle');
    });
  });
});
