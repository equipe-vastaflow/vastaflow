/**
 * URL base da API, resolvida a partir do ambiente de BUILD.
 *
 * Funcao pura, sem React e sem Vite: o mesmo criterio vale para o plugin que
 * roda no `vite build` e para o modulo que roda no navegador. E o padrao das
 * politicas do backend (`report-period.policy.ts`, `document-file.policy.ts`) -
 * a regra fica testavel sem subir nada.
 *
 * O problema que isto resolve: `VITE_API_URL` era opcional e o codigo caia em
 * `http://localhost:3000` quando ela faltava. Um build de producao sem a
 * variavel compilava sem erro e gerava um bundle que tentava chamar a maquina
 * de quem abrisse o navegador. Falha em runtime, para o usuario final, sem
 * nenhum sinal no build - a pior combinacao.
 *
 * `VITE_API_URL` NAO e segredo: e uma URL que o navegador precisa conhecer de
 * qualquer forma, e todo valor com prefixo `VITE_` vai para o bundle publico.
 * A regra geral segue valendo: nada sensivel pode ser uma variavel `VITE_*`.
 */

/**
 * Fallback usado SOMENTE fora de producao.
 *
 * Corresponde ao `PORT` padrao do backend. Em producao esta constante nunca e
 * alcancada: falta de `VITE_API_URL` lanca antes.
 */
export const DEV_API_URL = 'http://localhost:3000';

/** Mensagem da recusa. Nomeia a variavel e nao expoe valor algum. */
export const MISSING_API_URL_MESSAGE =
  'VITE_API_URL e obrigatoria no build de producao: informe a URL base da API (ex.: https://api.<dominio>). Sem ela o bundle apontaria para localhost.';

/** O que esta funcao le de `import.meta.env`. */
export interface ApiUrlEnv {
  /** `true` em build de producao. O Vite substitui isto no build. */
  readonly PROD?: boolean;
  readonly VITE_API_URL?: string;
}

/**
 * URL base da API, sem barra no final.
 *
 * Em producao a variavel e obrigatoria. Fora de producao, ausente, cai no
 * fallback de desenvolvimento - que e conveniencia local e nao pode vazar para
 * producao justamente porque o caminho de producao lanca.
 *
 * Um valor informado EXPLICITAMENTE e sempre respeitado, inclusive apontando
 * para localhost: isso e escolha de quem faz o build (um teste em modo de
 * producao, por exemplo). O que esta funcao impede e o fallback SILENCIOSO.
 *
 * @throws Error em producao sem `VITE_API_URL`.
 */
export function resolveApiUrl(env: ApiUrlEnv): string {
  // `trim` porque uma string so com espacos e truthy: sem isto ela passaria
  // como URL e a falha apareceria na primeira chamada, nao aqui.
  const informada = env.VITE_API_URL?.trim();

  if (informada !== undefined && informada !== '') {
    // Barra final removida porque cada chamada monta `${API_URL}/caminho`.
    return informada.replace(/\/+$/, '');
  }

  if (env.PROD === true) {
    throw new Error(MISSING_API_URL_MESSAGE);
  }

  return DEV_API_URL;
}
