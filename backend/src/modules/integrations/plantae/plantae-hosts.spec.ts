import { validateEnv } from '../../../config/env.validation';
import { PLANTAE_ENVIRONMENTS } from './plantae.constants';
import { parsePlantaeBaseUrl, resolvePlantaeSettings } from './plantae-settings';

/**
 * Hosts aceitos pela integracao: EXATAMENTE dois. Nenhuma chamada de rede, nenhuma credencial real: so URLs e um token
 * FALSO. A classificacao de `web.plantae.agr.br` como producao ainda depende de confirmacao escrita do fornecedor.
 */
const HOMOLOGACAO = 'https://rc.plantae.agr.br/api/v1/external';
const PRODUCAO = 'https://web.plantae.agr.br/api/v1/external';
const TOKEN_FALSO = 'plt_TOKEN_FALSO_para_o_teste_de_hosts_0123456789';

const baseEnv = {
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'vastaflow',
  DATABASE_USER: 'vastaflow',
  DATABASE_PASSWORD: 'senha-de-teste',
};

function config(values: Record<string, unknown>): { get: <T>(key: string) => T | undefined } {
  return { get: <T>(key: string): T | undefined => values[key] as T | undefined };
}

function mensagem(env: Record<string, unknown>): string {
  try {
    validateEnv({ ...baseEnv, ...env });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('deveria ter falhado');
}

describe('lista de hosts do Plantae (fechada)', () => {
  it('tem EXATAMENTE dois hosts: homologacao e producao, e nenhum outro', () => {
    expect(Object.entries(PLANTAE_ENVIRONMENTS).sort()).toEqual([
      ['rc.plantae.agr.br', 'homologation'],
      ['web.plantae.agr.br', 'production'],
    ]);
  });

  it('as chaves ja estao em minusculas e sem ponto final (a comparacao e exata)', () => {
    for (const host of Object.keys(PLANTAE_ENVIRONMENTS)) {
      expect(host).toBe(host.toLowerCase());
      expect(host.endsWith('.')).toBe(false);
    }
  });
});

describe('parsePlantaeBaseUrl: os dois hosts', () => {
  it.each([
    ['homologacao', HOMOLOGACAO, 'homologation'],
    ['producao', PRODUCAO, 'production'],
  ])('aceita %s e a identifica corretamente', (_nome, url, ambiente) => {
    expect(parsePlantaeBaseUrl(url)).toEqual({ ok: true, baseUrl: url, environment: ambiente });
  });

  it.each([
    ['HTTPS://WEB.Plantae.agr.br/api/v1/external/', PRODUCAO, 'production'],
    ['  https://web.plantae.agr.br/api/v1/external  ', PRODUCAO, 'production'],
    ['HTTPS://RC.Plantae.agr.br/api/v1/external/', HOMOLOGACAO, 'homologation'],
  ])('normaliza maiusculas, espacos e barra final (%s)', (entrada, esperada, ambiente) => {
    expect(parsePlantaeBaseUrl(entrada)).toMatchObject({
      ok: true,
      baseUrl: esperada,
      environment: ambiente,
    });
  });

  it('producao NUNCA e identificada como homologacao, e vice-versa', () => {
    const prod = parsePlantaeBaseUrl(PRODUCAO);
    const homolog = parsePlantaeBaseUrl(HOMOLOGACAO);

    expect(prod.ok && prod.environment).toBe('production');
    expect(homolog.ok && homolog.environment).toBe('homologation');
  });
});

/** Cada variante vale para os DOIS hosts; todas devem ser recusadas. */
const variantes = (host: string): [string, string][] => [
  ['http (sem TLS)', `http://${host}/api/v1/external`],
  ['porta explicita', `https://${host}:8443/api/v1/external`],
  ['porta padrao explicita ainda e porta diferente de vazio? (443 e normalizada)', ''],
  ['usuario e senha', `https://u:p@${host}/api/v1/external`],
  ['so usuario', `https://u@${host}/api/v1/external`],
  ['query string', `https://${host}/api/v1/external?x=1`],
  ['fragmento', `https://${host}/api/v1/external#x`],
  ['caminho de outra versao', `https://${host}/api/v2/external`],
  ['sem caminho', `https://${host}`],
  ['so a barra', `https://${host}/`],
  ['caminho mais longo', `https://${host}/api/v1/external/financial`],
  ['caminho mais curto', `https://${host}/api/v1`],
  ['caminho com barra duplicada', `https://${host}//api/v1/external`],
  ['caminho em outra caixa', `https://${host}/API/v1/external`],
  ['sufixo no caminho', `https://${host}/api/v1/externalx`],
  ['caminho com ponto-e-virgula', `https://${host}/api/v1/external;x`],
  ['esquema errado', `ftp://${host}/api/v1/external`],
  ['esquema ausente', `${host}/api/v1/external`],
];

describe.each([
  ['homologacao', 'rc.plantae.agr.br'],
  ['producao', 'web.plantae.agr.br'],
])('parsePlantaeBaseUrl: variantes recusadas (%s)', (_nome, host) => {
  it.each(variantes(host).filter(([, url]) => url !== ''))('recusa %s', (_n, url) => {
    expect(parsePlantaeBaseUrl(url).ok).toBe(false);
  });

  it.each([
    ['subdominio acrescentado', `x.${host}`],
    ['host como subdominio de terceiro', `${host}.evil.com`],
    ['prefixo colado', `x${host}`],
    ['prefixo com hifen', `x-${host}`],
    ['ponto final (FQDN absoluto)', `${host}.`],
    ['letra trocada', host.replace('plantae', 'plantea')],
    ['dominio de topo trocado', host.replace('.agr.br', '.com.br')],
    ['sem o segmento agr', host.replace('.agr', '')],
  ])('recusa host: %s', (_n, hostRuim) => {
    const result = parsePlantaeBaseUrl(`https://${hostRuim}/api/v1/external`);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem).toContain('host');
  });
});

describe('parsePlantaeBaseUrl: formas equivalentes viram SEMPRE a URL canonica', () => {
  // O parser de URL do Node normaliza barras invertidas e caracteres de largura zero. Aceitar essas formas e inofensivo
  // porque a URL USADA depois e reconstruida so a partir do host exato da lista: nunca sobra nada da entrada.
  it.each([
    ['web.plantae.agr.br', PRODUCAO],
    ['rc.plantae.agr.br', HOMOLOGACAO],
  ])(
    '%s: barras invertidas e espaco de largura zero resultam na URL canonica',
    (host, canonica) => {
      const bs = String.fromCharCode(92);
      const barras = `https:${bs}${bs}${host}${bs}api${bs}v1${bs}external`;
      const largura = `https://${host}${String.fromCharCode(0x200b)}/api/v1/external`;
      for (const entrada of [barras, largura]) {
        const result = parsePlantaeBaseUrl(entrada);

        // Se aceita, a base e EXATAMENTE a canonica (e o host e o da lista); se recusada, tambem e seguro.
        if (result.ok) {
          expect(result.baseUrl).toBe(canonica);
        }
      }
      // Pelo menos a barra invertida e aceita hoje: a assercao acima nao e vazia.
      expect(parsePlantaeBaseUrl(barras).ok).toBe(true);
    },
  );
});

describe('parsePlantaeBaseUrl: outros hosts e truques de URL', () => {
  it.each([
    ['dominio raiz', 'https://plantae.agr.br/api/v1/external'],
    ['www', 'https://www.plantae.agr.br/api/v1/external'],
    ['app', 'https://app.plantae.agr.br/api/v1/external'],
    ['api', 'https://api.plantae.agr.br/api/v1/external'],
    ['outro ambiente por palavra', 'https://hml.plantae.agr.br/api/v1/external'],
    ['dev', 'https://dev.plantae.agr.br/api/v1/external'],
    ['outro dominio qualquer', 'https://example.com/api/v1/external'],
    ['localhost', 'https://localhost/api/v1/external'],
    ['IPv4', 'https://203.0.113.10/api/v1/external'],
    ['IPv6', 'https://[2001:db8::1]/api/v1/external'],
    ['homografo cirilico (e no lugar do e latino)', 'https://wеb.plantae.agr.br/api/v1/external'],
    ['host real so no caminho', 'https://evil.com/web.plantae.agr.br/api/v1/external'],
    ['host real como usuario (@)', 'https://web.plantae.agr.br@evil.com/api/v1/external'],
    ['host real como usuario com senha', 'https://web.plantae.agr.br:x@evil.com/api/v1/external'],
    ['host real no fragmento', 'https://evil.com/api/v1/external#web.plantae.agr.br'],
    ['host real na query', 'https://evil.com/api/v1/external?h=web.plantae.agr.br'],
    ['barra invertida antes do @', 'https://web.plantae.agr.br\\@evil.com/api/v1/external'],
    ['host em decimal', 'https://3405803776/api/v1/external'],
  ])('recusa %s', (_nome, url) => {
    expect(parsePlantaeBaseUrl(url).ok).toBe(false);
  });

  it.each([
    ['nao e URL', 'isto nao e uma url'],
    ['vazio', ''],
    ['so espacos', '    '],
    ['so o esquema', 'https://'],
    ['caracter de controle', 'https://web.plantae.agr.br/api/v1/external\r\nX: 1'],
  ])('recusa malformada: %s', (_nome, url) => {
    expect(parsePlantaeBaseUrl(url).ok).toBe(false);
  });

  it('as mensagens de recusa NAO repetem a URL (que pode conter credencial) nem o host informado', () => {
    for (const url of [
      'https://ZEBRA-LOGIN:SEGREDO-123@web.plantae.agr.br/api/v1/external',
      'https://web.plantae.agr.br:SEGREDO-123@outro-host-secreto.com/api/v1/external',
      'https://outro-host-secreto.com/api/v1/external?token=SEGREDO-123',
    ]) {
      const bruto = JSON.stringify(parsePlantaeBaseUrl(url));

      expect(bruto).not.toContain('SEGREDO-123');
      expect(bruto).not.toContain('ZEBRA-LOGIN');
      expect(bruto).not.toContain('outro-host-secreto');
    }
  });
});

describe('resolvePlantaeSettings: ambiente por host', () => {
  it.each([
    [HOMOLOGACAO, 'homologation'],
    [PRODUCAO, 'production'],
  ])('%s -> %s', (url, ambiente) => {
    expect(
      resolvePlantaeSettings(config({ PLANTAE_ENABLED: true, PLANTAE_BASE_URL: url })),
    ).toMatchObject({ enabled: true, baseUrl: url, environment: ambiente });
  });

  it('URL invalida resolve para "nao configurado" (nunca para um ambiente)', () => {
    for (const url of [
      'https://evil.com/api/v1/external',
      'http://web.plantae.agr.br/api/v1/external',
    ]) {
      expect(
        resolvePlantaeSettings(config({ PLANTAE_ENABLED: true, PLANTAE_BASE_URL: url })),
      ).toMatchObject({
        baseUrl: null,
        environment: null,
      });
    }
  });

  it('sem URL, o ambiente e desconhecido mesmo com a integracao ligada', () => {
    expect(resolvePlantaeSettings(config({ PLANTAE_ENABLED: true })).environment).toBeNull();
  });
});

describe('validateEnv: os dois hosts e os padroes seguros', () => {
  it('padrao: tudo desligado, sem exigir nenhuma variavel do Plantae', () => {
    const env = validateEnv(baseEnv);

    expect(env.PLANTAE_ENABLED).toBe(false);
    expect(env.PLANTAE_CHAT_COMMANDS_ENABLED).toBe(false);
    expect(env.PLANTAE_ORGANIZATION_CONFIRMED).toBe(false);
    expect(env.PLANTAE_CHAT_SHOW_PAYEE_NAME).toBe(false);
  });

  it.each([HOMOLOGACAO, PRODUCAO])(
    'o boot aceita %s com a integracao desligada, sem ligar nenhuma flag',
    (url) => {
      const env = validateEnv({ ...baseEnv, PLANTAE_BASE_URL: url });

      expect(env.PLANTAE_BASE_URL).toBe(url);
      expect(env.PLANTAE_ENABLED).toBe(false);
      expect(env.PLANTAE_CHAT_COMMANDS_ENABLED).toBe(false);
      expect(env.PLANTAE_ORGANIZATION_CONFIRMED).toBe(false);
    },
  );

  it.each([HOMOLOGACAO, PRODUCAO])(
    'o boot aceita %s ligado com token (so leitura, chat ainda desligado)',
    (url) => {
      const env = validateEnv({
        ...baseEnv,
        PLANTAE_ENABLED: 'true',
        PLANTAE_BASE_URL: url,
        PLANTAE_API_TOKEN: TOKEN_FALSO,
      });

      expect(env.PLANTAE_ENABLED).toBe(true);
      expect(env.PLANTAE_CHAT_COMMANDS_ENABLED).toBe(false);
      expect(env.PLANTAE_ORGANIZATION_CONFIRMED).toBe(false);
    },
  );

  it.each([
    'https://plantae.agr.br/api/v1/external',
    'https://www.plantae.agr.br/api/v1/external',
    'https://web.plantae.agr.br.evil.com/api/v1/external',
    'http://web.plantae.agr.br/api/v1/external',
    'https://web.plantae.agr.br:8443/api/v1/external',
    'https://web.plantae.agr.br/api/v2/external',
    'https://web.plantae.agr.br',
    'https://u:p@web.plantae.agr.br/api/v1/external',
  ])('o boot RECUSA %s, mesmo com a integracao desligada, sem repetir a URL', (url) => {
    const texto = mensagem({ PLANTAE_ENABLED: 'false', PLANTAE_BASE_URL: url });

    expect(texto).toContain('PLANTAE_BASE_URL invalida');
    expect(texto).not.toContain('evil.com');
    expect(texto).not.toContain('8443');
  });

  it.each([HOMOLOGACAO, PRODUCAO])(
    'com %s, o chat ligado SEM o atestado da organizacao recusa o boot; com o atestado, sobe',
    (url) => {
      const comChat = {
        PLANTAE_ENABLED: 'true',
        PLANTAE_BASE_URL: url,
        PLANTAE_API_TOKEN: TOKEN_FALSO,
        PLANTAE_CHAT_COMMANDS_ENABLED: 'true',
      };

      expect(mensagem(comChat)).toContain('PLANTAE_ORGANIZATION_CONFIRMED');
      expect(() =>
        validateEnv({ ...baseEnv, ...comChat, PLANTAE_ORGANIZATION_CONFIRMED: 'true' }),
      ).not.toThrow();
    },
  );
});
