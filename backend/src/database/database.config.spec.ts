import { DatabaseType } from '../config/env.validation';
import {
  buildDataSourceOptions,
  MISSING_CA_MESSAGE,
  type DatabaseEnvironment,
} from './database.config';

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

    it('com DATABASE_SSL e sem CA a configuracao e RECUSADA', () => {
      // Antes isto caia no perfil embarcado 'Amazon RDS' do driver - uma CA que
      // assina os certificados de toda instancia RDS de todo cliente AWS.
      // Numa instalacao self-hosted nao chega a conectar; apontando para RDS
      // seria confiar numa CA compartilhada com milhares de instancias alheias.
      expect(() => buildDataSourceOptions({ ...baseEnv, DATABASE_SSL: true })).toThrow(
        MISSING_CA_MESSAGE,
      );
    });

    it('a recusa por CA ausente nomeia a variavel e nao expoe valor algum', () => {
      expect(MISSING_CA_MESSAGE).toContain('DATABASE_SSL_CA');
      expect(MISSING_CA_MESSAGE).not.toMatch(/-----BEGIN|senha|password|secret/i);
    });

    it('a opcao ssl e sempre um objeto, nunca o nome de um perfil do driver', () => {
      // Blinda a remocao do fallback: `ssl` como string faria o mysql2 resolver
      // um perfil de CA embarcado (`getSSLProfile`), que e o comportamento
      // retirado. Com CA ausente nao ha caminho nenhum - lanca, como o teste
      // acima comprova.
      const ssl = sslDe({ ...baseEnv, DATABASE_SSL: true, DATABASE_SSL_CA: 'pem-qualquer' });

      expect(typeof ssl).toBe('object');
    });

    it.each(['', '   ', '\n\t '])('CA em branco (%j) conta como ausente', (ca) => {
      // Uma string so com espacos e truthy: sem o `trim` ela seria repassada ao
      // driver e a falha apareceria no handshake, com mensagem obscura.
      expect(() =>
        buildDataSourceOptions({ ...baseEnv, DATABASE_SSL: true, DATABASE_SSL_CA: ca }),
      ).toThrow(MISSING_CA_MESSAGE);
    });

    it('com CA informada exige cadeia E identidade', () => {
      const ca = '-----BEGIN CERTIFICATE-----\nconteudo\n-----END CERTIFICATE-----';

      // As duas garantias sao opcoes SEPARADAS no mysql2, e apenas
      // `rejectUnauthorized` tem valor padrao. Sem `verifyIdentity` o driver
      // troca `checkServerIdentity` por uma funcao vazia: qualquer certificado
      // assinado por esta CA passaria a servir para qualquer hostname.
      expect(sslDe({ ...baseEnv, DATABASE_SSL: true, DATABASE_SSL_CA: ca })).toEqual({
        ca,
        rejectUnauthorized: true,
        verifyIdentity: true,
      });
    });

    it('a verificacao da CADEIA nunca e desligada', () => {
      const ssl = sslDe({ ...baseEnv, DATABASE_SSL: true, DATABASE_SSL_CA: 'pem-qualquer' });

      expect((ssl as { rejectUnauthorized?: unknown }).rejectUnauthorized).toBe(true);
      expect(JSON.stringify(ssl)).not.toContain('"rejectUnauthorized":false');
    });

    it('a verificacao da IDENTIDADE nunca e desligada', () => {
      // Este e o teste que a configuracao anterior nao tinha, e por isso a
      // conferencia de hostname ficou desligada sem ninguem notar.
      const ssl = sslDe({ ...baseEnv, DATABASE_SSL: true, DATABASE_SSL_CA: 'pem-qualquer' });

      expect((ssl as { verifyIdentity?: unknown }).verifyIdentity).toBe(true);
      expect(JSON.stringify(ssl)).not.toContain('"verifyIdentity":false');
    });

    it('nenhuma variavel de ambiente consegue desligar as duas garantias', () => {
      // Mesmo que alguem tente passar as chaves pelo ambiente, elas nao fazem
      // parte de `DatabaseEnvironment` e o objeto e montado do zero aqui.
      const hostil = {
        ...baseEnv,
        DATABASE_SSL: true,
        DATABASE_SSL_CA: 'pem-qualquer',
        rejectUnauthorized: false,
        verifyIdentity: false,
      } as unknown as DatabaseEnvironment;

      expect(sslDe(hostil)).toEqual({
        ca: 'pem-qualquer',
        rejectUnauthorized: true,
        verifyIdentity: true,
      });
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
      // O deploy pode usar a URL em vez dos campos separados; as duas garantias
      // nao podem depender dessa escolha.
      const options = buildDataSourceOptions({
        ...baseEnv,
        DATABASE_URL: 'mysql://usuario:senha@host:3306/vastaflow',
        DATABASE_SSL: true,
        DATABASE_SSL_CA: 'pem-qualquer',
      });

      expect((options as { ssl?: unknown }).ssl).toEqual({
        ca: 'pem-qualquer',
        rejectUnauthorized: true,
        verifyIdentity: true,
      });
      expect((options as { url?: string }).url).toBeDefined();
    });

    it('a CA tambem e exigida quando a conexao vem por DATABASE_URL', () => {
      expect(() =>
        buildDataSourceOptions({
          ...baseEnv,
          DATABASE_URL: 'mysql://usuario:senha@host:3306/vastaflow',
          DATABASE_SSL: true,
        }),
      ).toThrow(MISSING_CA_MESSAGE);
    });

    it('nao altera charset nem timezone', () => {
      const options = buildDataSourceOptions({
        ...baseEnv,
        DATABASE_SSL: true,
        DATABASE_SSL_CA: 'pem-qualquer',
      }) as {
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

    it('a exigencia de CA do MySQL NAO vaza para o Oracle', () => {
      // O Oracle retorna antes de `buildMysqlSsl`, entao `DATABASE_SSL=true`
      // sem CA nao derruba a configuracao Oracle. Sem este teste, a exigencia
      // nova poderia passar a bloquear um driver a que ela nao se aplica.
      expect(() =>
        buildDataSourceOptions({ ...oracleEnv, DATABASE_SSL: true, DATABASE_SSL_CA: undefined }),
      ).not.toThrow();
    });
  });
});
