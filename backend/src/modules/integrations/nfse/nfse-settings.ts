/**
 * Configuracao da NFS-e Nacional (Emissor Publico Nacional / Sefin Nacional).
 *
 * Tudo vem do `.env` do servidor e SO o backend as recebe (nem o n8n, nem o frontend). O certificado
 * digital NAO e uma variavel: so o CAMINHO do arquivo `.pfx` e a senha. Desligada por padrao.
 */

export const NFSE_ENABLED_KEY = 'NFSE_ENABLED';

/** `tpAmb` da DPS: 1 = producao, 2 = homologacao (producao restrita). Layout oficial v1.01. */
export type NfseTipoAmbiente = 1 | 2;

/**
 * Enderecos da Sefin Nacional, DERIVADOS do endereco da documentacao publicada em
 * gov.br/nfse (".../docs/index"). O Swagger exige certificado e nao pode ser lido sem ele, entao
 * o caminho-base nao foi confirmado em operacao: por isso o cliente so fala com estes hosts quando
 * `NFSE_WIRE_CONTRACT_CONFIRMED=true` (ver `docs/nfse.md`).
 */
export const NFSE_OFFICIAL_BASES: Record<'restrita' | 'producao', string> = {
  restrita: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
};

/**
 * AUTORIZACAO DE PRODUCAO: segunda chave, independente de `NFSE_WIRE_CONTRACT_CONFIRMED`, exigida SO para emitir
 * em producao real. Nao e um booleano: e uma FRASE EXATA que embute o CNPJ do prestador, para que nao possa ser
 * ligada por engano, por copia de um `.env` de outra empresa, nem por outra variavel.
 * Vazia (padrao) = producao bloqueada. Na restrita NAO e exigida e NAO pode estar definida.
 */
export const NFSE_PRODUCAO_AUTORIZACAO_PREFIXO = 'EMITIR-NFSE-REAL-';
export const producaoAutorizacaoEsperada = (cnpjPrestador: string): string =>
  `${NFSE_PRODUCAO_AUTORIZACAO_PREFIXO}${cnpjPrestador}`;

/** Hosts de servidor de TESTE aceitos em `NFSE_API_BASE_URL` (lista fechada, como Telegram/WhatsApp). */
export const NFSE_TEST_HOSTS: readonly string[] = ['nfse-fake', 'localhost', '127.0.0.1'];

export const NFSE_DEFAULT_CONFIRMATION_TTL_MINUTES = 10;

const CNPJ = /^\d{14}$/;
const IBGE = /^\d{7}$/;
const SERIE = /^\d{1,5}$/;
const MONEY = /^\d{1,13}(\.\d{2})?$/;

type NfseEnvKey =
  | 'NFSE_AMBIENTE'
  | 'NFSE_API_BASE_URL'
  | 'NFSE_WIRE_CONTRACT_CONFIRMED'
  | 'NFSE_CERT_PFX_PATH'
  | 'NFSE_CERT_PFX_PASSWORD'
  | 'NFSE_CA_BUNDLE_PATH'
  | 'NFSE_PRESTADOR_CNPJ'
  | 'NFSE_PRESTADOR_IM'
  | 'NFSE_PRESTADOR_NOME'
  | 'NFSE_MUNICIPIO_EMISSOR_IBGE'
  | 'NFSE_OPCAO_SIMPLES'
  | 'NFSE_REGIME_APURACAO_SN'
  | 'NFSE_REGIME_ESPECIAL_TRIBUTACAO'
  | 'NFSE_DPS_SERIE'
  | 'NFSE_VALOR_MAXIMO'
  | 'NFSE_CONFIRMATION_TTL_MINUTES'
  | 'NFSE_PERFIS_FISCAIS_PATH'
  | 'NFSE_PRODUCAO_AUTORIZACAO';

export type NfseEnv = Partial<Record<NfseEnvKey, unknown>>;

export interface NfseSettings {
  readonly ambiente: 'restrita' | 'producao';
  readonly tpAmb: NfseTipoAmbiente;
  readonly baseUrl: string;
  readonly testServer: boolean;
  readonly wireContractConfirmed: boolean;
  /** `true` SO em producao com `NFSE_PRODUCAO_AUTORIZACAO` exata. Sem isso, nada vai a Sefin de producao. */
  readonly producaoAutorizada: boolean;
  readonly certPfxPath: string;
  readonly certPfxPassword: string;
  readonly caBundlePath: string | null;
  readonly prestadorCnpj: string;
  readonly prestadorIm: string | null;
  readonly prestadorNome: string | null;
  readonly municipioEmissor: string;
  /** 1 = nao optante, 2 = MEI, 3 = ME/EPP. */
  readonly opSimpNac: 1 | 2 | 3;
  readonly regApTribSN: 1 | 2 | 3 | null;
  /** 0 = nenhum ... 9 = outros (tabela do layout). */
  readonly regEspTrib: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9;
  readonly serie: string;
  /** Texto decimal exato (`1000.00`). Limite por emissao decidido pela cliente: sem valor padrao. */
  readonly valorMaximo: string;
  readonly confirmationTtlMs: number;
  /**
   * Arquivo dos perfis fiscais aprovados (`nfse-fiscal-profile.ts`). Obrigatorio para empresa NAO optante
   * (`opSimpNac = 1`); nao usado para ME/EPP. Fora do repositorio, montado somente leitura.
   */
  readonly perfisFiscaisPath: string | null;
}

export type NfseSettingsResult =
  | { readonly ok: true; readonly settings: NfseSettings }
  | { readonly ok: false; readonly problems: readonly string[] };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function parseBoolean(value: unknown): boolean {
  return value === true || text(value).toLowerCase() === 'true';
}

/** Resolve a base da API. Vazio = a oficial do ambiente. Mensagens fixas: o valor nunca e repetido. */
export function resolveNfseBase(
  ambiente: 'restrita' | 'producao',
  raw: unknown,
):
  | { readonly ok: true; readonly base: string; readonly testServer: boolean }
  | { readonly ok: false; readonly problem: string } {
  const value = text(raw);
  if (value === '') {
    return { ok: true, base: NFSE_OFFICIAL_BASES[ambiente], testServer: false };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, problem: 'nao e uma URL valida' };
  }
  if (url.protocol !== 'http:' || url.username !== '' || url.password !== '') {
    return { ok: false, problem: 'deve ser http, sem usuario ou senha (servidor de teste)' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, problem: 'nao pode ter query nem fragmento' };
  }
  if (!NFSE_TEST_HOSTS.includes(url.hostname.toLowerCase())) {
    return {
      ok: false,
      problem: `o host deve ser um servidor de teste: ${NFSE_TEST_HOSTS.join(', ')}`,
    };
  }
  return { ok: true, base: url.origin + url.pathname.replace(/\/$/, ''), testServer: true };
}

/** Valor monetario de entrada ("1500", "1500,5", "1500.50") -> texto decimal exato com 2 casas. */
export function normalizeMoney(raw: string): string | null {
  const match = /^(\d{1,13})(?:[.,](\d{1,2}))?$/.exec(raw.trim());
  if (match === null) {
    return null;
  }
  return `${String(BigInt(match[1] ?? '0'))}.${(match[2] ?? '').padEnd(2, '0')}`;
}

export function moneyToCents(decimal: string): bigint {
  return BigInt(decimal.replace('.', ''));
}

/**
 * Valida e resolve. Mensagens fixas: nenhum valor - especialmente senha e caminho do certificado -
 * e repetido. Ligada exige TUDO que e decisao fiscal da cliente: nao ha padrao tributario.
 */
export function resolveNfseSettings(raw: NfseEnv & { NFSE_ENABLED?: unknown }): NfseSettingsResult {
  const problems: string[] = [];
  const ambienteRaw = text(raw.NFSE_AMBIENTE);
  const ambiente = ambienteRaw === 'restrita' || ambienteRaw === 'producao' ? ambienteRaw : null;
  if (ambiente === null) {
    problems.push("NFSE_AMBIENTE deve ser 'restrita' ou 'producao' (sem valor padrao)");
  }

  const requireText = (key: NfseEnvKey): string => {
    const value = text(raw[key]);
    if (value === '') {
      problems.push(`${key} e obrigatorio quando NFSE_ENABLED=true`);
    }
    return value;
  };
  const certPfxPath = requireText('NFSE_CERT_PFX_PATH');
  const certPfxPassword = requireText('NFSE_CERT_PFX_PASSWORD');
  const prestadorCnpj = requireText('NFSE_PRESTADOR_CNPJ');
  if (prestadorCnpj !== '' && !CNPJ.test(prestadorCnpj)) {
    problems.push('NFSE_PRESTADOR_CNPJ invalido: use 14 digitos, sem pontuacao');
  }
  // Limites do leiaute (TSInscMun ate 15, TSNomeRazaoSocial ate 300): configuracao fora disso so
  // falharia depois, na Sefin ou no esquema.
  // eslint-disable-next-line no-control-regex
  const control = /[\x00-\x1f\x7f]/;
  if (text(raw.NFSE_PRESTADOR_IM).length > 15 || control.test(text(raw.NFSE_PRESTADOR_IM))) {
    problems.push('NFSE_PRESTADOR_IM invalida: ate 15 caracteres');
  }
  if (text(raw.NFSE_PRESTADOR_NOME).length > 300 || control.test(text(raw.NFSE_PRESTADOR_NOME))) {
    problems.push('NFSE_PRESTADOR_NOME invalida: ate 300 caracteres, sem quebra de linha');
  }
  const municipioEmissor = requireText('NFSE_MUNICIPIO_EMISSOR_IBGE');
  if (municipioEmissor !== '' && !IBGE.test(municipioEmissor)) {
    problems.push('NFSE_MUNICIPIO_EMISSOR_IBGE invalido: use o codigo IBGE de 7 digitos');
  }
  const serie = requireText('NFSE_DPS_SERIE');
  if (serie !== '' && !SERIE.test(serie)) {
    problems.push('NFSE_DPS_SERIE invalida: use de 1 a 5 digitos');
  } else if (serie !== '' && (Number(serie) < 1 || Number(serie) > 49999)) {
    // Faixa oficial (Anexo I, regra E0010): 00001 a 49999 = emissao com aplicativo proprio.
    problems.push('NFSE_DPS_SERIE fora da faixa 1 a 49999 (aplicativo proprio)');
  }
  const valorMaximo = normalizeMoney(requireText('NFSE_VALOR_MAXIMO'));
  if (valorMaximo !== null && !MONEY.test(valorMaximo)) {
    problems.push('NFSE_VALOR_MAXIMO invalido');
  } else if (valorMaximo === null && text(raw.NFSE_VALOR_MAXIMO) !== '') {
    problems.push('NFSE_VALOR_MAXIMO invalido: use um numero como 1500 ou 1500.50');
  } else if (valorMaximo !== null && moneyToCents(valorMaximo) <= 0n) {
    problems.push('NFSE_VALOR_MAXIMO deve ser maior que zero');
  }

  const opRaw = requireText('NFSE_OPCAO_SIMPLES');
  const opSimpNac = ['1', '2', '3'].includes(opRaw) ? (Number(opRaw) as 1 | 2 | 3) : null;
  if (opRaw !== '' && opSimpNac === null) {
    problems.push('NFSE_OPCAO_SIMPLES invalida: use 1 (nao optante), 2 (MEI) ou 3 (ME/EPP)');
  }
  const perfisFiscaisPath = text(raw.NFSE_PERFIS_FISCAIS_PATH);
  if (opSimpNac === 1 && perfisFiscaisPath === '') {
    // O grupo IBS/CBS e obrigatorio para quem NAO e optante do Simples (Anexo I). Classificacao tributaria e
    // codigos sao decisao fiscal da contadora: so se emite com perfis fiscais APROVADOS (arquivo externo).
    problems.push(
      'NFSE_OPCAO_SIMPLES=1 (nao optante) exige NFSE_PERFIS_FISCAIS_PATH: sem perfil fiscal aprovado nao se emite',
    );
  }
  if (opSimpNac !== 1 && perfisFiscaisPath !== '') {
    problems.push(
      'NFSE_PERFIS_FISCAIS_PATH so se aplica a empresa nao optante (NFSE_OPCAO_SIMPLES=1)',
    );
  }
  const regApRaw = text(raw.NFSE_REGIME_APURACAO_SN);
  const regApTribSN = ['1', '2', '3'].includes(regApRaw) ? (Number(regApRaw) as 1 | 2 | 3) : null;
  if (regApRaw !== '' && (regApTribSN === null || opSimpNac !== 3)) {
    problems.push(
      'NFSE_REGIME_APURACAO_SN so vale para ME/EPP (NFSE_OPCAO_SIMPLES=3), com 1, 2 ou 3',
    );
  }
  const regEspRaw = requireText('NFSE_REGIME_ESPECIAL_TRIBUTACAO');
  const regEspTrib = ['0', '1', '2', '3', '4', '5', '6', '9'].includes(regEspRaw)
    ? (Number(regEspRaw) as NfseSettings['regEspTrib'])
    : null;
  if (regEspRaw !== '' && regEspTrib === null) {
    problems.push('NFSE_REGIME_ESPECIAL_TRIBUTACAO invalido: use 0, 1, 2, 3, 4, 5, 6 ou 9');
  }

  const ttlRaw = text(raw.NFSE_CONFIRMATION_TTL_MINUTES);
  const ttlMinutes = ttlRaw === '' ? NFSE_DEFAULT_CONFIRMATION_TTL_MINUTES : Number(ttlRaw);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 2 || ttlMinutes > 30) {
    problems.push('NFSE_CONFIRMATION_TTL_MINUTES invalido: use de 2 a 30');
  }

  const base = ambiente === null ? null : resolveNfseBase(ambiente, raw.NFSE_API_BASE_URL);
  if (base !== null && !base.ok) {
    problems.push(`NFSE_API_BASE_URL invalida: ${base.problem}`);
  }
  const wireContractConfirmed = parseBoolean(raw.NFSE_WIRE_CONTRACT_CONFIRMED);
  // Autorizacao de producao: independente do contrato e de qualquer outra variavel (so este valor a liga).
  const autorizacaoRaw = text(raw.NFSE_PRODUCAO_AUTORIZACAO);
  let producaoAutorizada = false;
  if (autorizacaoRaw !== '') {
    if (ambiente !== 'producao') {
      problems.push(
        'NFSE_PRODUCAO_AUTORIZACAO so se aplica a NFSE_AMBIENTE=producao: remova-a da configuracao da restrita',
      );
    } else if (
      CNPJ.test(prestadorCnpj) &&
      autorizacaoRaw !== producaoAutorizacaoEsperada(prestadorCnpj)
    ) {
      problems.push(
        `NFSE_PRODUCAO_AUTORIZACAO invalida: o valor exato e ${NFSE_PRODUCAO_AUTORIZACAO_PREFIXO}<CNPJ do prestador>`,
      );
    } else if (CNPJ.test(prestadorCnpj)) {
      producaoAutorizada = true;
    }
  }
  if (
    ambiente === 'producao' &&
    !wireContractConfirmed &&
    base !== null &&
    base.ok &&
    !base.testServer
  ) {
    problems.push(
      'NFSE_AMBIENTE=producao exige NFSE_WIRE_CONTRACT_CONFIRMED=true (contrato validado antes em homologacao)',
    );
  }

  if (
    problems.length > 0 ||
    ambiente === null ||
    base === null ||
    !base.ok ||
    opSimpNac === null ||
    regEspTrib === null ||
    valorMaximo === null
  ) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    settings: {
      ambiente,
      tpAmb: ambiente === 'producao' ? 1 : 2,
      baseUrl: base.base,
      testServer: base.testServer,
      wireContractConfirmed,
      producaoAutorizada,
      certPfxPath,
      certPfxPassword,
      caBundlePath: text(raw.NFSE_CA_BUNDLE_PATH) === '' ? null : text(raw.NFSE_CA_BUNDLE_PATH),
      prestadorCnpj,
      prestadorIm: text(raw.NFSE_PRESTADOR_IM) === '' ? null : text(raw.NFSE_PRESTADOR_IM),
      prestadorNome: text(raw.NFSE_PRESTADOR_NOME) === '' ? null : text(raw.NFSE_PRESTADOR_NOME),
      municipioEmissor,
      opSimpNac,
      regApTribSN,
      regEspTrib,
      serie: serie.padStart(5, '0'),
      valorMaximo,
      confirmationTtlMs: ttlMinutes * 60_000,
      perfisFiscaisPath: perfisFiscaisPath === '' ? null : perfisFiscaisPath,
    },
  };
}

/** Problemas de configuracao, para o `env.validation`. So se avalia quando `NFSE_ENABLED=true`. */
export function validateNfseSettings(env: NfseEnv & { NFSE_ENABLED?: unknown }): string[] {
  if (!parseBoolean(env.NFSE_ENABLED)) {
    return [];
  }
  const result = resolveNfseSettings(env);
  return result.ok ? [] : [...result.problems];
}
