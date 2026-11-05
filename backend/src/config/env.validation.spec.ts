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
      // Mudou de `true` para `false` no hardening: documentacao e opt-in.
      SWAGGER_ENABLED: false,
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
      expect(() => validateEnv({ ...baseEnv, SEED_ADMIN_EMAIL: 'admin@example.com' })).toThrow(
        /SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD/,
      );
    });

    it('aceita o par completo', () => {
      const env = validateEnv({
        ...baseEnv,
        SEED_ADMIN_EMAIL: 'admin@example.com',
        SEED_ADMIN_PASSWORD: 'Senha@1234',
      });
      expect(env.SEED_ADMIN_EMAIL).toBe('admin@example.com');
    });
  });

  describe('swagger', () => {
    /**
     * Producao com MySQL exige TLS **e** a CA; sem as duas a recusa viria por
     * outro motivo e o teste de Swagger passaria por acidente.
     */
    const prodEnv = {
      ...baseEnv,
      NODE_ENV: Environment.Production,
      DATABASE_SSL: 'true',
      DATABASE_SSL_CA: 'pem-qualquer',
    };

    it('producao sem a variavel: Swagger nasce DESLIGADO', () => {
      expect(validateEnv(prodEnv).SWAGGER_ENABLED).toBe(false);
    });

    it('producao com false: aceito e desligado', () => {
      expect(validateEnv({ ...prodEnv, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
    });

    it('producao com true: configuracao RECUSADA no boot', () => {
      // Mesmo tratamento de DATABASE_SYNCHRONIZE: a aplicacao nao sobe, em vez
      // de subir com a documentacao exposta.
      expect(() => validateEnv({ ...prodEnv, SWAGGER_ENABLED: 'true' })).toThrow(/SWAGGER_ENABLED/);
    });

    it('desenvolvimento com true: aceito e ligado', () => {
      expect(validateEnv({ ...baseEnv, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
    });

    it('desenvolvimento sem a variavel: tambem nasce desligado', () => {
      // Padrao seguro em TODO ambiente; o `.env.example` liga explicitamente.
      expect(validateEnv(baseEnv).SWAGGER_ENABLED).toBe(false);
    });

    it("qualquer valor diferente de 'true' mantem desligado", () => {
      for (const valor of ['TRUE', '1', 'yes', 'sim', '']) {
        expect(validateEnv({ ...baseEnv, SWAGGER_ENABLED: valor }).SWAGGER_ENABLED).toBe(false);
      }
    });
  });

  describe('TLS do banco', () => {
    const prodEnv = { ...baseEnv, NODE_ENV: Environment.Production, SWAGGER_ENABLED: 'false' };

    it('padrao e desligado, para nao exigir TLS do MySQL local', () => {
      expect(validateEnv(baseEnv).DATABASE_SSL).toBe(false);
      expect(validateEnv(baseEnv).DATABASE_SSL_CA).toBeUndefined();
    });

    it("interpreta DATABASE_SSL='true' como booleano", () => {
      expect(validateEnv({ ...baseEnv, DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true);
    });

    it("qualquer valor diferente de 'true' e tratado como false", () => {
      // Nao ha coercao perigosa: 'TRUE', '1' e 'yes' NAO ligam TLS por acidente.
      for (const valor of ['TRUE', '1', 'yes', 'sim', '']) {
        expect(validateEnv({ ...baseEnv, DATABASE_SSL: valor }).DATABASE_SSL).toBe(false);
      }
    });

    it('producao com MySQL e sem TLS: configuracao RECUSADA', () => {
      expect(() => validateEnv(prodEnv)).toThrow(/DATABASE_SSL/);
    });

    it('producao com MySQL, TLS ligado e CA informada: aceito', () => {
      const env = validateEnv({
        ...prodEnv,
        DATABASE_SSL: 'true',
        DATABASE_SSL_CA: 'pem-qualquer',
      });

      expect(env.DATABASE_SSL).toBe(true);
      expect(env.DATABASE_SSL_CA).toBe('pem-qualquer');
    });

    it('producao com MySQL e TLS ligado SEM CA: configuracao RECUSADA', () => {
      // Antes isto era aceito e caia no perfil embarcado 'Amazon RDS' do
      // driver. Numa instalacao que nao e RDS, confiar nessa CA nao faz
      // sentido - e com ela a verificacao de identidade desligada, como estava,
      // qualquer certificado assinado pela Amazon serviria.
      expect(() => validateEnv({ ...prodEnv, DATABASE_SSL: 'true' })).toThrow(/DATABASE_SSL_CA/);
    });

    it('a recusa por CA ausente nao expoe valor de variavel alguma', () => {
      try {
        validateEnv({ ...prodEnv, DATABASE_SSL: 'true', JWT_SECRET: baseEnv.JWT_SECRET });
        throw new Error('deveria ter sido recusado');
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);

        expect(mensagem).toContain('DATABASE_SSL_CA');
        expect(mensagem).not.toContain(baseEnv.JWT_SECRET);
        expect(mensagem).not.toContain(baseEnv.DATABASE_PASSWORD);
      }
    });

    it('desenvolvimento com TLS ligado nao exige CA na validacao de ambiente', () => {
      // A exigencia e uma regra de PRODUCAO. Em desenvolvimento quem ligar TLS
      // sem CA e recusado na montagem da configuracao (`buildMysqlSsl`), nao
      // aqui - a mensagem continua clara, e o ambiente de desenvolvimento nao
      // ganha uma barreira que nao precisa.
      expect(() => validateEnv({ ...baseEnv, DATABASE_SSL: 'true' })).not.toThrow();
    });

    describe('origem da CA: conteudo ou arquivo, exatamente uma', () => {
      it('producao com DATABASE_SSL_CA_FILE em vez do conteudo: aceito', () => {
        // A forma adequada a container: um PEM e multilinha, e valor multilinha
        // em arquivo `.env` lido pelo Compose e fragil.
        const env = validateEnv({
          ...prodEnv,
          DATABASE_SSL: 'true',
          DATABASE_SSL_CA_FILE: '/etc/vastaflow/tls/ca.pem',
        });

        expect(env.DATABASE_SSL_CA_FILE).toBe('/etc/vastaflow/tls/ca.pem');
        expect(env.DATABASE_SSL_CA).toBeUndefined();
      });

      it('as DUAS informadas: configuracao RECUSADA', () => {
        expect(() =>
          validateEnv({
            ...prodEnv,
            DATABASE_SSL: 'true',
            DATABASE_SSL_CA: 'pem-qualquer',
            DATABASE_SSL_CA_FILE: '/etc/vastaflow/tls/ca.pem',
          }),
        ).toThrow(/nunca as duas/);
      });

      it('a ambiguidade e recusada mesmo FORA de producao', () => {
        // A confusao na configuracao existe independente do ambiente, e
        // descobri-la em desenvolvimento e melhor que em producao.
        expect(() =>
          validateEnv({
            ...baseEnv,
            DATABASE_SSL_CA: 'pem-qualquer',
            DATABASE_SSL_CA_FILE: '/etc/vastaflow/tls/ca.pem',
          }),
        ).toThrow(/nunca as duas/);
      });

      it('a ambiguidade e recusada mesmo com TLS desligado', () => {
        expect(() =>
          validateEnv({
            ...baseEnv,
            DATABASE_SSL: 'false',
            DATABASE_SSL_CA: 'pem-qualquer',
            DATABASE_SSL_CA_FILE: '/etc/vastaflow/tls/ca.pem',
          }),
        ).toThrow(/nunca as duas/);
      });

      it('producao com TLS e NENHUMA das duas: RECUSADO, citando as duas', () => {
        try {
          validateEnv({ ...prodEnv, DATABASE_SSL: 'true' });
          throw new Error('deveria ter sido recusado');
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : String(erro);

          expect(mensagem).toContain('DATABASE_SSL_CA');
          expect(mensagem).toContain('DATABASE_SSL_CA_FILE');
        }
      });

      it('caminho em branco conta como ausente', () => {
        expect(() =>
          validateEnv({ ...prodEnv, DATABASE_SSL: 'true', DATABASE_SSL_CA_FILE: '   ' }),
        ).toThrow(/DATABASE_SSL_CA/);
      });

      it('a validacao de ambiente NAO le o arquivo', () => {
        // Caminho inexistente passa aqui de proposito: esta camada so verifica a
        // coerencia da configuracao, sem I/O. Quem le - e recusa - e
        // `resolveSslCa`, na montagem das opcoes.
        expect(() =>
          validateEnv({
            ...prodEnv,
            DATABASE_SSL: 'true',
            DATABASE_SSL_CA_FILE: '/caminho/que/nao/existe/ca.pem',
          }),
        ).not.toThrow();
      });
    });

    it('producao com CA so de espacos conta como ausente', () => {
      // `optionalString` transforma '   ' em undefined antes da regra cruzada.
      expect(() =>
        validateEnv({ ...prodEnv, DATABASE_SSL: 'true', DATABASE_SSL_CA: '   ' }),
      ).toThrow(/DATABASE_SSL_CA/);
    });

    it('producao com Oracle nao exige DATABASE_SSL', () => {
      // O TLS do Oracle e configurado na string de conexao do proprio driver.
      const oracle = validateEnv({
        ...prodEnv,
        DATABASE_TYPE: DatabaseType.Oracle,
        DATABASE_ORACLE_SERVICE_NAME: 'VASTA',
      });

      expect(oracle.DATABASE_SSL).toBe(false);
    });

    it('desenvolvimento sem TLS continua valido', () => {
      expect(validateEnv(baseEnv).NODE_ENV).toBe(Environment.Development);
    });

    it('a CA e lida como texto e tem os espacos das pontas removidos', () => {
      const pem = '-----BEGIN CERTIFICATE-----\nconteudo\n-----END CERTIFICATE-----';

      expect(
        validateEnv({ ...baseEnv, DATABASE_SSL: 'true', DATABASE_SSL_CA: `  ${pem}  ` })
          .DATABASE_SSL_CA,
      ).toBe(pem);
    });

    describe('identidade do servidor: o host nao pode ser um IP', () => {
      /** Producao com MySQL, TLS e CA: so falta decidir o host. */
      const comTls = { ...prodEnv, DATABASE_SSL: 'true', DATABASE_SSL_CA: 'pem-qualquer' };

      it.each(['127.0.0.1', '10.0.0.5', '192.168.1.10', '::1', 'fe80::1'])(
        'producao com TLS e host %j: RECUSADO',
        (host) => {
          // O `mysql2` so envia `servername` ao TLS quando o host NAO e um IP.
          // Sem `servername`, a conferencia de hostname e saltada em silencio -
          // exatamente o problema que `verifyIdentity: true` resolve. Um IP aqui
          // devolveria o furo de forma invisivel.
          expect(() => validateEnv({ ...comTls, DATABASE_HOST: host })).toThrow(/IP/);
        },
      );

      it.each(['mysql', 'vastaflow-mysql', 'mysql.vastaflow.internal', 'db.exemplo.test'])(
        'producao com TLS e host %j: aceito',
        (host) => {
          expect(validateEnv({ ...comTls, DATABASE_HOST: host }).DATABASE_HOST).toBe(host);
        },
      );

      it('o host da DATABASE_URL tambem e conferido', () => {
        // A URL tem precedencia sobre os campos separados, entao a regra precisa
        // olhar para o mesmo lugar que o driver.
        expect(() =>
          validateEnv({ ...comTls, DATABASE_URL: 'mysql://u:s@10.0.0.5:3306/vastaflow' }),
        ).toThrow(/IP/);
        expect(() =>
          validateEnv({ ...comTls, DATABASE_URL: 'mysql://u:s@mysql:3306/vastaflow' }),
        ).not.toThrow();
      });

      it('IPv6 entre colchetes na URL tambem e reconhecido', () => {
        expect(() =>
          validateEnv({ ...comTls, DATABASE_URL: 'mysql://u:s@[::1]:3306/vastaflow' }),
        ).toThrow(/IP/);
      });

      it('sem TLS a regra nao se aplica: IP continua valido', () => {
        // Sem TLS nao ha identidade a conferir, e o MySQL local costuma ser
        // alcancado por 127.0.0.1. A regra existe para proteger uma garantia,
        // nao para proibir IP por principio.
        expect(validateEnv({ ...baseEnv, DATABASE_HOST: '127.0.0.1' }).DATABASE_HOST).toBe(
          '127.0.0.1',
        );
      });

      it('fora de producao a regra nao se aplica', () => {
        expect(() =>
          validateEnv({ ...baseEnv, DATABASE_SSL: 'true', DATABASE_HOST: '127.0.0.1' }),
        ).not.toThrow();
      });

      it('producao com Oracle nao e afetada', () => {
        // Oracle nao usa a opcao `ssl` do mysql2 nem passa por esta regra.
        expect(() =>
          validateEnv({
            ...prodEnv,
            DATABASE_TYPE: DatabaseType.Oracle,
            DATABASE_ORACLE_SERVICE_NAME: 'VASTA',
            DATABASE_HOST: '10.0.0.5',
          }),
        ).not.toThrow();
      });
    });

    it('nao existe variavel para desligar nenhuma das duas verificacoes', () => {
      // Blinda a decisao: nem `rejectUnauthorized: false` nem
      // `verifyIdentity: false` sao configuraveis por ambiente.
      const chaves = Object.keys(validateEnv({ ...baseEnv, DATABASE_SSL: 'true' }));

      expect(chaves.filter((chave) => /REJECT|VERIFY|INSECURE|IDENTITY/i.test(chave))).toEqual([]);
    });
  });

  describe('telegram', () => {
    it('opcional: sem as variaveis, token ausente e polling desligado', () => {
      const env = validateEnv(baseEnv);

      expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
      expect(env.TELEGRAM_POLLING_ENABLED).toBe(false);
    });

    it('token em branco conta como ausente', () => {
      expect(
        validateEnv({ ...baseEnv, TELEGRAM_BOT_TOKEN: '   ' }).TELEGRAM_BOT_TOKEN,
      ).toBeUndefined();
    });

    it('o polling so liga com true explicito', () => {
      expect(
        validateEnv({ ...baseEnv, TELEGRAM_POLLING_ENABLED: 'true' }).TELEGRAM_POLLING_ENABLED,
      ).toBe(true);
      expect(
        validateEnv({ ...baseEnv, TELEGRAM_POLLING_ENABLED: 'false' }).TELEGRAM_POLLING_ENABLED,
      ).toBe(false);
      expect(
        validateEnv({ ...baseEnv, TELEGRAM_POLLING_ENABLED: '' }).TELEGRAM_POLLING_ENABLED,
      ).toBe(false);
    });

    it('polling ligado sem token nao impede a aplicacao de subir', () => {
      expect(() => validateEnv({ ...baseEnv, TELEGRAM_POLLING_ENABLED: 'true' })).not.toThrow();
    });
  });
  describe('Telegram + n8n (Fase 5)', () => {
    const CHAVE = 'k'.repeat(40);
    const URL_N8N = 'http://n8n:5678/webhook/vastaflow-telegram';

    it('padrao: modo direto, sem URL, sem chave, comandos de chat do Plantae desligados', () => {
      const env = validateEnv(baseEnv);

      expect(env.TELEGRAM_DELIVERY_MODE).toBe('direct');
      expect(env.TELEGRAM_N8N_WEBHOOK_URL).toBeUndefined();
      expect(env.TELEGRAM_INGEST_SIGNING_KEY).toBeUndefined();
      expect(env.PLANTAE_CHAT_COMMANDS_ENABLED).toBe(false);
    });

    it('modo n8n completo e aceito', () => {
      const env = validateEnv({
        ...baseEnv,
        TELEGRAM_DELIVERY_MODE: 'n8n',
        TELEGRAM_N8N_WEBHOOK_URL: URL_N8N,
        TELEGRAM_INGEST_SIGNING_KEY: CHAVE,
      });

      expect(env.TELEGRAM_DELIVERY_MODE).toBe('n8n');
    });

    it('a chave sozinha (modo direto) e aceita: a entrada de servico pode estar pronta antes do relay', () => {
      expect(() => validateEnv({ ...baseEnv, TELEGRAM_INGEST_SIGNING_KEY: CHAVE })).not.toThrow();
    });

    it.each(['webhook', 'N8N', 'both', 'true'])('modo invalido (%s) e recusado', (modo) => {
      expect(() => validateEnv({ ...baseEnv, TELEGRAM_DELIVERY_MODE: modo })).toThrow(
        /TELEGRAM_DELIVERY_MODE/,
      );
    });

    it('modo n8n sem URL: recusado', () => {
      expect(() =>
        validateEnv({
          ...baseEnv,
          TELEGRAM_DELIVERY_MODE: 'n8n',
          TELEGRAM_INGEST_SIGNING_KEY: CHAVE,
        }),
      ).toThrow(/TELEGRAM_N8N_WEBHOOK_URL/);
    });

    it('modo n8n sem chave: recusado', () => {
      expect(() =>
        validateEnv({
          ...baseEnv,
          TELEGRAM_DELIVERY_MODE: 'n8n',
          TELEGRAM_N8N_WEBHOOK_URL: URL_N8N,
        }),
      ).toThrow(/TELEGRAM_INGEST_SIGNING_KEY/);
    });

    it('chave curta e recusada em qualquer modo, e o valor nunca aparece na mensagem', () => {
      let mensagem = '';
      try {
        validateEnv({ ...baseEnv, TELEGRAM_INGEST_SIGNING_KEY: 'curta-demais-SEGREDO' });
      } catch (error) {
        mensagem = (error as Error).message;
      }

      expect(mensagem).toMatch(/TELEGRAM_INGEST_SIGNING_KEY/);
      expect(mensagem).not.toContain('SEGREDO');
    });

    it.each([
      'http://exemplo.com/webhook/x',
      'http://u:SEGREDO@n8n:5678/webhook/x',
      'http://n8n:5678/rest/login',
      'nao-e-url',
    ])('URL do webhook invalida (%s) e recusada sem repetir o valor', (url) => {
      let mensagem = '';
      try {
        validateEnv({ ...baseEnv, TELEGRAM_N8N_WEBHOOK_URL: url });
      } catch (error) {
        mensagem = (error as Error).message;
      }

      expect(mensagem).toMatch(/TELEGRAM_N8N_WEBHOOK_URL/);
      expect(mensagem).not.toContain('SEGREDO');
      expect(mensagem).not.toContain('exemplo.com');
    });

    it('PLANTAE_CHAT_COMMANDS_ENABLED so liga com true explicito', () => {
      expect(
        validateEnv({ ...baseEnv, PLANTAE_CHAT_COMMANDS_ENABLED: 'true' })
          .PLANTAE_CHAT_COMMANDS_ENABLED,
      ).toBe(true);
      for (const valor of ['false', '', '1', 'sim']) {
        expect(
          validateEnv({ ...baseEnv, PLANTAE_CHAT_COMMANDS_ENABLED: valor })
            .PLANTAE_CHAT_COMMANDS_ENABLED,
        ).toBe(false);
      }
    });
  });
  describe('Telegram: servidor de teste e limite por usuario (Fase 5.1)', () => {
    it('padroes: Bot API oficial e 10 mensagens por minuto', () => {
      const env = validateEnv(baseEnv);

      expect(env.TELEGRAM_API_BASE_URL).toBeUndefined();
      expect(env.TELEGRAM_USER_RATE_LIMIT_PER_MINUTE).toBe(10);
    });

    it('aceita so servidores de teste (lista fechada)', () => {
      expect(() =>
        validateEnv({ ...baseEnv, TELEGRAM_API_BASE_URL: 'http://telegram-fake:8081' }),
      ).not.toThrow();
      for (const url of [
        'http://evil.example',
        'https://api.telegram.org',
        'http://u:SEGREDO@telegram-fake',
      ]) {
        let mensagem = '';
        try {
          validateEnv({ ...baseEnv, TELEGRAM_API_BASE_URL: url });
        } catch (error) {
          mensagem = (error as Error).message;
        }
        expect(mensagem).toMatch(/TELEGRAM_API_BASE_URL/);
        expect(mensagem).not.toContain('SEGREDO');
        expect(mensagem).not.toContain('evil.example');
      }
    });

    it.each(['0', '121', '-1', 'abc', '1.5'])('limite invalido (%s) e recusado', (valor) => {
      expect(() => validateEnv({ ...baseEnv, TELEGRAM_USER_RATE_LIMIT_PER_MINUTE: valor })).toThrow(
        /TELEGRAM_USER_RATE_LIMIT_PER_MINUTE/,
      );
    });

    it('limite valido e convertido para numero', () => {
      expect(
        validateEnv({ ...baseEnv, TELEGRAM_USER_RATE_LIMIT_PER_MINUTE: '30' })
          .TELEGRAM_USER_RATE_LIMIT_PER_MINUTE,
      ).toBe(30);
    });
  });
  describe('Plantae no chat: organizacao confirmada e politica de favorecido (Fase 6)', () => {
    const plantaeLigado = {
      PLANTAE_ENABLED: 'true',
      PLANTAE_BASE_URL: 'https://rc.plantae.agr.br/api/v1/external',
      PLANTAE_API_TOKEN: 'plt_TOKEN_FALSO_apenas_para_testes_0123456789abcdef',
    };

    it('padroes: organizacao NAO confirmada e favorecido oculto', () => {
      const env = validateEnv(baseEnv);

      expect(env.PLANTAE_ORGANIZATION_CONFIRMED).toBe(false);
      expect(env.PLANTAE_CHAT_SHOW_PAYEE_NAME).toBe(false);
    });

    it('FAIL-CLOSED: comando de chat + Plantae ativo sem organizacao confirmada derruba o boot', () => {
      expect(() =>
        validateEnv({ ...baseEnv, ...plantaeLigado, PLANTAE_CHAT_COMMANDS_ENABLED: 'true' }),
      ).toThrow(/PLANTAE_ORGANIZATION_CONFIRMED/);
    });

    it('com a organizacao confirmada, o boot passa', () => {
      expect(() =>
        validateEnv({
          ...baseEnv,
          ...plantaeLigado,
          PLANTAE_CHAT_COMMANDS_ENABLED: 'true',
          PLANTAE_ORGANIZATION_CONFIRMED: 'true',
        }),
      ).not.toThrow();
    });

    it.each([
      ['integracao ligada, comando de chat desligado', { PLANTAE_ENABLED: 'true' }],
      ['comando de chat ligado, integracao desligada', { PLANTAE_CHAT_COMMANDS_ENABLED: 'true' }],
      ['tudo desligado', {}],
    ] as Array<[string, Record<string, string>]>)(
      '%s: nao exige o atestado (nada financeiro sai pelo chat)',
      (_nome, extra) => {
        expect(() =>
          validateEnv({
            ...baseEnv,
            ...(extra.PLANTAE_ENABLED === undefined ? {} : plantaeLigado),
            ...extra,
          }),
        ).not.toThrow();
      },
    );

    it('so o texto "true" liga as flags', () => {
      for (const valor of ['1', 'sim', 'TRUE', '']) {
        const env = validateEnv({
          ...baseEnv,
          PLANTAE_ORGANIZATION_CONFIRMED: valor,
          PLANTAE_CHAT_SHOW_PAYEE_NAME: valor,
        });
        expect(env.PLANTAE_ORGANIZATION_CONFIRMED).toBe(false);
        expect(env.PLANTAE_CHAT_SHOW_PAYEE_NAME).toBe(false);
      }
    });

    it('a mensagem de recusa nao repete segredo', () => {
      let mensagem = '';
      try {
        validateEnv({ ...baseEnv, ...plantaeLigado, PLANTAE_CHAT_COMMANDS_ENABLED: 'true' });
      } catch (error) {
        mensagem = (error as Error).message;
      }

      expect(mensagem).not.toContain('plt_TOKEN_FALSO');
    });
  });
  describe('WhatsApp (Cloud API)', () => {
    const completo: Record<string, string> = {
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_WEBHOOK_TOKEN: 'token-do-webhook-123456',
      WHATSAPP_APP_SECRET: 'app-secret-de-teste-0123456789',
      WHATSAPP_ACCESS_TOKEN: 'EAAG-token-de-teste-0123456789',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_GRAPH_API_VERSION: 'v21.0',
    };

    it('padrao: desligado, sem nenhuma variavel exigida', () => {
      expect(validateEnv(baseEnv).WHATSAPP_ENABLED).toBe(false);
    });

    it('ligado e completo: passa', () => {
      expect(validateEnv({ ...baseEnv, ...completo }).WHATSAPP_ENABLED).toBe(true);
    });

    it.each([
      'WHATSAPP_WEBHOOK_TOKEN',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_GRAPH_API_VERSION',
    ])('ligado sem %s: o boot e recusado', (faltando) => {
      const resto = Object.fromEntries(Object.entries(completo).filter(([k]) => k !== faltando));

      expect(() => validateEnv({ ...baseEnv, ...resto })).toThrow(new RegExp(faltando));
    });

    it('valores implausiveis sao recusados sem repetir o segredo', () => {
      let mensagem = '';
      try {
        validateEnv({ ...baseEnv, ...completo, WHATSAPP_APP_SECRET: 'curto SEGREDO' });
      } catch (error) {
        mensagem = (error as Error).message;
      }

      expect(mensagem).toMatch(/WHATSAPP_APP_SECRET/);
      expect(mensagem).not.toContain('SEGREDO');
    });

    describe('transporte gateway (Baileys)', () => {
      const gateway: Record<string, string> = {
        WHATSAPP_ENABLED: 'true',
        WHATSAPP_TRANSPORT: 'gateway',
        WHATSAPP_GATEWAY_ACCOUNT: '5511900000000',
        SERVICE_CREDENTIALS_FILE: '/run/secrets/credentials.json',
      };

      it('padrao: transporte meta (comportamento de sempre), sem conta de gateway', () => {
        const env = validateEnv(baseEnv);

        expect(env.WHATSAPP_TRANSPORT).toBeUndefined();
        expect(env.WHATSAPP_GATEWAY_ACCOUNT).toBeUndefined();
      });

      it('ligado e completo: passa SEM nenhuma variavel da Meta', () => {
        expect(validateEnv({ ...baseEnv, ...gateway }).WHATSAPP_ENABLED).toBe(true);
      });

      it.each(['WHATSAPP_GATEWAY_ACCOUNT', 'SERVICE_CREDENTIALS_FILE'])(
        'ligado sem %s: o boot e recusado',
        (faltando) => {
          const resto = Object.fromEntries(Object.entries(gateway).filter(([k]) => k !== faltando));

          expect(() => validateEnv({ ...baseEnv, ...resto })).toThrow(new RegExp(faltando));
        },
      );

      it('desligado, o gateway nao exige nada', () => {
        expect(() =>
          validateEnv({ ...baseEnv, WHATSAPP_ENABLED: 'false', WHATSAPP_TRANSPORT: 'gateway' }),
        ).not.toThrow();
      });

      it('transporte invalido e conta fora do formato sao recusados, sem repetir o valor', () => {
        expect(() => validateEnv({ ...baseEnv, WHATSAPP_TRANSPORT: 'telegram' })).toThrow(
          /WHATSAPP_TRANSPORT/,
        );
        let mensagem = '';
        try {
          validateEnv({ ...baseEnv, ...gateway, WHATSAPP_GATEWAY_ACCOUNT: '+55 (11) SEGREDO' });
        } catch (error) {
          mensagem = (error as Error).message;
        }
        expect(mensagem).toMatch(/WHATSAPP_GATEWAY_ACCOUNT/);
        expect(mensagem).not.toContain('SEGREDO');
      });

      it('em meta, ligar continua exigindo as variaveis da Meta (nada mudou)', () => {
        expect(() =>
          validateEnv({ ...baseEnv, WHATSAPP_ENABLED: 'true', WHATSAPP_TRANSPORT: 'meta' }),
        ).toThrow(/WHATSAPP_WEBHOOK_TOKEN/);
      });
    });

    it('base da Graph fora da lista de hosts de teste: recusada', () => {
      expect(() =>
        validateEnv({ ...baseEnv, ...completo, WHATSAPP_API_BASE_URL: 'http://evil.example' }),
      ).toThrow(/WHATSAPP_API_BASE_URL/);
      expect(() =>
        validateEnv({
          ...baseEnv,
          ...completo,
          WHATSAPP_API_BASE_URL: 'http://whatsapp-fake:8082',
        }),
      ).not.toThrow();
    });
  });
});
