import type { SettingValue } from './setting-value';
import { SystemSettingType } from './system-setting.enums';

/** Formato exigido da chave: maiusculas, digitos e `_`, comecando por letra. */
export const SETTING_KEY_FORMAT = /^[A-Z][A-Z0-9_]*$/;

export interface SettingDefinition {
  chave: string;
  tipo: SystemSettingType;
  /** Texto mostrado na tela de administracao. */
  descricao: string;
  /** Valor com que a chave nasce, quando o seeder a cria. */
  padrao: SettingValue;
}

/**
 * Catalogo de configuracoes do sistema.
 *
 * Fonte unica das chaves: o seeder cria no banco o que faltar, a cada boot e
 * sem sobrescrever valores ja administrados. Nao ha rota para criar ou apagar
 * chave - acrescentar uma configuracao e mudar este arquivo.
 *
 * A lista e curta de proposito. Cada entrada corresponde a um valor que HOJE
 * existe fixo no codigo; nao ha chave inventada para "preencher o banco", e
 * nada aqui contem dado de cliente, URL real, credencial ou segredo.
 *
 * ATENCAO: nesta etapa as chaves sao apenas armazenadas e administradas -
 * nenhum outro modulo as le ainda. Ligar uma configuracao ao comportamento de
 * um modulo (por exemplo, fazer as listagens usarem
 * `PAGINATION_DEFAULT_LIMIT`) muda o comportamento desse modulo e e uma
 * decisao a parte, feita junto com ele. O caminho de leitura ja existe e esta
 * pronto: `SystemSettingsService`.
 */
export const SETTING_CATALOG: readonly SettingDefinition[] = [
  {
    chave: 'SYSTEM_NAME',
    tipo: SystemSettingType.String,
    descricao: 'Nome do sistema exibido nas telas e nos relatorios',
    // Hoje o nome aparece fixo no cabecalho do frontend.
    padrao: 'VastaFlow',
  },
  {
    chave: 'PAGINATION_DEFAULT_LIMIT',
    tipo: SystemSettingType.Number,
    descricao: 'Quantidade padrao de itens por pagina nas listagens',
    // Mesmo numero que hoje esta fixo em cada listagem (DEFAULT_PAGE_SIZE).
    padrao: 20,
  },
];
