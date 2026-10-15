/**
 * Catalogo de permissoes granulares do sistema.
 *
 * Formato `<recurso>:<acao>`. Cada modulo novo acrescenta aqui as suas
 * permissoes e o seeder as cria no banco no proximo boot - nenhuma mudanca de
 * schema e necessaria.
 *
 * Hoje ha apenas as permissoes exercitadas pelo modulo de usuarios e auditoria;
 * as demais serao definidas junto com os modulos que as usam.
 */
export enum PermissionCode {
  UsersRead = 'users:read',
  UsersCreate = 'users:create',
  UsersUpdate = 'users:update',
  UsersStatus = 'users:status',
  UsersRole = 'users:role',
  AuditRead = 'audit:read',

  FinanceRead = 'finance:read',
  FinanceCreate = 'finance:create',
  FinanceUpdate = 'finance:update',
  FinanceStatus = 'finance:status',

  SettingsRead = 'settings:read',
  SettingsUpdate = 'settings:update',

  // Documentos. Apenas ler e enviar: renomear, excluir e versionar nao existem
  // nesta fase, e permissao sem operacao correspondente e vocabulario inerte -
  // foi o criterio que levou a NAO criar `finance:export`.
  DocumentsRead = 'documents:read',
  DocumentsCreate = 'documents:create',

  // Consulta a dados financeiros EXTERNOS (Plantae) pelos canais de mensageria.
  // Permissao propria, e nao `finance:read`: aquela cobre o financeiro LOCAL, e
  // reaproveita-la daria ao GESTOR (que a tem) acesso aos dados da cliente no
  // Plantae sem decisao nenhuma. So o ADMIN a tem por padrao; ampliar e decisao.
  PlantaeRead = 'plantae:read',

  // NFS-e. Documento fiscal tem efeito legal: permissoes PROPRIAS e sem nenhum perfil que as tenha
  // por padrao (so o ADMIN, que passa em qualquer verificacao). Conceder a um perfil e decisao
  // explicita da cliente, nunca conveniencia.
  NfseEmit = 'nfse:emit',
  NfseRead = 'nfse:read',
}

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  [PermissionCode.UsersRead]: 'Listar e consultar usuarios',
  [PermissionCode.UsersCreate]: 'Criar usuarios',
  [PermissionCode.UsersUpdate]: 'Editar nome e e-mail de usuarios',
  [PermissionCode.UsersStatus]: 'Ativar e desativar usuarios',
  [PermissionCode.UsersRole]: 'Alterar o perfil de usuarios',
  [PermissionCode.AuditRead]: 'Consultar o log de auditoria',
  [PermissionCode.FinanceRead]: 'Consultar lancamentos financeiros',
  [PermissionCode.FinanceCreate]: 'Criar lancamentos financeiros',
  [PermissionCode.FinanceUpdate]: 'Editar lancamentos financeiros',
  [PermissionCode.FinanceStatus]: 'Alterar o status de lancamentos financeiros',
  [PermissionCode.SettingsRead]: 'Consultar as configuracoes do sistema',
  [PermissionCode.SettingsUpdate]: 'Alterar o valor das configuracoes do sistema',
  [PermissionCode.DocumentsRead]: 'Listar e baixar documentos',
  [PermissionCode.DocumentsCreate]: 'Enviar documentos',
  [PermissionCode.PlantaeRead]:
    'Consultar dados financeiros do Plantae pelos canais (somente leitura)',
  [PermissionCode.NfseEmit]: 'Solicitar e confirmar a emissao de NFS-e pelos canais',
  [PermissionCode.NfseRead]: 'Consultar a situacao de NFS-e emitidas pelos canais',
};
