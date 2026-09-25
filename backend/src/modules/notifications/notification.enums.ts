/**
 * Natureza da notificacao, usada pela tela para dar o tom certo ao aviso.
 *
 * Quatro valores, de proposito: e a classificacao minima que cobre "informe",
 * "deu certo", "atencao" e "deu errado". Tipo novo entra quando houver um
 * modulo que realmente precise dele.
 */
export enum NotificationType {
  Info = 'INFO',
  Success = 'SUCCESS',
  Warning = 'WARNING',
  Error = 'ERROR',
}
