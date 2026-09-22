/**
 * Coloca o processo em modo de producao.
 *
 * Existe como modulo separado por causa de uma ordem que importa: o
 * `ConfigModule.forRoot()` le e valida o ambiente quando `app.module.ts` e
 * IMPORTADO, nao quando a aplicacao e criada. Depois disso o ambiente validado
 * esta fixado para o processo inteiro, e mexer em `process.env` nao tem mais
 * efeito.
 *
 * Importar este arquivo ANTES de qualquer outro que alcance o `AppModule`
 * garante que a aplicacao nasca em producao. A saida do TypeScript e CommonJS
 * (ADR 0002), entao os imports viram `require` na ordem em que aparecem no
 * arquivo - manter este em primeiro lugar e o que faz a troca valer.
 *
 * So faz sentido em um arquivo de teste dedicado: o Jest da a cada arquivo o
 * seu proprio registro de modulos, e as demais suites continuam em
 * `NODE_ENV=test`.
 */
process.env.NODE_ENV = 'production';
