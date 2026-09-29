/**
 * O minimo do `ConfigService` que esta funcao usa. Estrutural de proposito: o
 * `ConfigService` do Nest satisfaz, e o teste nao precisa montar um modulo.
 */
export interface ConfigReader {
  get<T = unknown>(propertyPath: string): T | undefined;
}

/**
 * `true` quando TODAS as chaves informadas tem valor na configuracao.
 *
 * Existe para um provider decidir entre `READY` e `NOT_CONFIGURED` sem que o
 * valor saia daqui: a funcao devolve so um booleano. Quem chama nunca precisa
 * ler o segredo para saber se ele existe.
 *
 * Valor ausente, nulo ou texto em branco conta como "nao configurado" - o mesmo
 * criterio de `isBlank` em `env.validation.ts`, onde variavel vazia no `.env`
 * equivale a variavel ausente.
 *
 * Le pelo `ConfigService` ja existente, e nao por `process.env` direto: e a
 * mesma fonte que o resto da aplicacao usa, e o `.env` do backend entra nela.
 * Nenhuma variavel de integracao e exigida pelo `validateEnv` - elas so passam
 * a existir quando o respectivo provider for implementado.
 */
export function hasConfigValues(config: ConfigReader, keys: readonly string[]): boolean {
  return keys.every((key) => {
    const value: unknown = config.get<unknown>(key);
    if (value === undefined || value === null) {
      return false;
    }
    return typeof value !== 'string' || value.trim() !== '';
  });
}
