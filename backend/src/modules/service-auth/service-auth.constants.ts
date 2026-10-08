/**
 * Cabecalho da credencial de servico.
 *
 * Proprio e DISTINTO de `Authorization: Bearer` de proposito: os dois esquemas
 * percorrem caminhos de codigo diferentes. Com `Bearer` compartilhado, um erro
 * de ordenacao de guards poderia fazer um token de servico ser tratado como JWT
 * de pessoa, ou o contrario.
 *
 * Em minusculas porque o Node normaliza os nomes de cabecalho recebidos.
 */
export const SERVICE_TOKEN_HEADER = 'x-service-token';

/**
 * Mensagem UNICA de recusa de autenticacao.
 *
 * Cabecalho ausente, formato errado, token desconhecido, revogado, expirado e
 * arquivo de credenciais indisponivel devolvem exatamente esta resposta: quem
 * esta do lado de fora nao descobre qual deles foi. O motivo real so vai para o
 * log do servidor.
 */
export const SERVICE_UNAUTHORIZED_MESSAGE = 'Credencial de servico invalida';

/** Credencial valida, mas sem o escopo que a rota exige. */
export const SERVICE_FORBIDDEN_MESSAGE = 'Servico sem permissao para esta acao';

/** Marca a rota como EXCLUSIVA de servico (autenticada por `X-Service-Token`). */
export const SERVICE_ROUTE_KEY = 'serviceAuth:serviceRoute';

/** Escopos que a rota de servico exige. */
export const SERVICE_SCOPES_KEY = 'serviceAuth:scopes';

/** Prefixo do token: facilita varredura de segredo vazado (secret scanning). */
export const SERVICE_TOKEN_PREFIX = 'vfs_';

/** Bytes de entropia do token: 256 bits. */
export const SERVICE_TOKEN_BYTES = 32;

/**
 * Formato aceito: prefixo + 32 bytes em base64url sem padding (43 caracteres).
 *
 * Verificar o formato ANTES de calcular o hash descarta lixo barato e limita o
 * tamanho do que e processado.
 */
export const SERVICE_TOKEN_PATTERN = /^vfs_[A-Za-z0-9_-]{43}$/;

/**
 * Por quanto tempo o arquivo de credenciais fica em cache, em ms.
 *
 * E o teto da latencia de uma revogacao: depois que a gravacao do arquivo e
 * visivel ao container, a credencial revogada deixa de valer em ate este tempo.
 * Nao exige reiniciar nada.
 */
export const SERVICE_CREDENTIALS_TTL_MS = 1000;
