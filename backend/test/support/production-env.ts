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

// A validacao de ambiente exige, em producao com MySQL: TLS ligado, a CA que
// assina o certificado do servidor, e um host que nao seja IP. O Swagger nasce
// desligado. Sem isto a aplicacao nao subiria - o que e justamente o
// comportamento desejado, mas impediria o teste de exercitar as rotas.
//
// A conexao e trocada por SQLite em memoria no `test-app`, entao nenhuma
// conexao TLS real acontece e este texto NAO e um certificado: e so o que faz
// a validacao de ambiente passar. Nao e, e nao deve ser, um PEM valido - um
// certificado de verdade no repositorio seria exatamente o que as regras do
// projeto proibem.
process.env.DATABASE_SSL = 'true';
process.env.DATABASE_SSL_CA = 'ca-de-teste-nao-e-um-certificado';
process.env.SWAGGER_ENABLED = 'false';
