/**
 * Tipo declarado de uma configuracao.
 *
 * O valor e sempre persistido como texto (portavel entre MySQL e Oracle, sem
 * JSON nativo); e o `tipo` que diz como interpreta-lo. Sem ele, `"true"` e
 * `"123"` seriam ambiguos.
 *
 * Deliberadamente limitado a tres tipos escalares: objetos JSON arbitrarios
 * ficam de fora desta primeira versao.
 */
export enum SystemSettingType {
  String = 'STRING',
  Number = 'NUMBER',
  Boolean = 'BOOLEAN',
}
