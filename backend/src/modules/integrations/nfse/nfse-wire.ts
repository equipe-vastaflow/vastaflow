import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * FORMATO DE TROCA COM A SEFIN NACIONAL (corpo JSON das rotas `POST /nfse`, `GET /dps/{id}`,
 * `GET /nfse/{chave}`).
 *
 * ATENCAO - NAO CONFIRMADO NO SWAGGER: o Swagger oficial exige certificado digital e responde 403 a
 * quem nao o apresenta; os manuais publicados descrevem as rotas, mas nao os nomes dos campos do JSON.
 * Os nomes abaixo vem do que o proprio manual confirma (area de dados compactada e em base 64, regras
 * E1225/E1226) e de convencao, e DEVEM ser conferidos em producao restrita. Por isso o cliente so
 * conversa com a Sefin real quando `NFSE_WIRE_CONTRACT_CONFIRMED=true`. Todo o resto do modulo (DPS,
 * XML, XSD, assinatura) usa contrato oficial e nao depende deste arquivo.
 *
 * Regra de ouro daqui: na duvida o resultado e INCERTO, nunca "nao emitida" e nunca "emitida".
 */

const CHAVE = /^\d{50}$/;
const ERROR_CODE = /^E\d{4}$/;
const MAX_XML_BYTES = 2 * 1024 * 1024;

/** Corpo do POST: o XML assinado, compactado (gzip) e em base 64. */
export function encodeEmissionBody(signedXml: string): string {
  return JSON.stringify({
    dpsXmlGZipB64: gzipSync(Buffer.from(signedXml, 'utf8')).toString('base64'),
  });
}

/** Descompacta um campo `...GZipB64`. `null` se nao for base64/gzip valido ou passar do limite. */
export function decodeGzipBase64(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }
  try {
    return gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: MAX_XML_BYTES }).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

export type EmissionOutcome =
  | { readonly kind: 'authorized'; readonly chave: string; readonly nfseXml: string }
  /** Rejeicao de negocio com codigo oficial (E####): a NFS-e NAO foi gerada. */
  | { readonly kind: 'rejected'; readonly code: string; readonly message: string }
  /** Certeza de que a requisicao nao chegou a ser processada (sem conexao, certificado recusado no TLS). */
  | { readonly kind: 'not_sent'; readonly reason: string }
  /** Nao se sabe se a NFS-e foi gerada. NUNCA reenviar sozinho. */
  | { readonly kind: 'uncertain'; readonly reason: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Primeiro erro oficial (`E####`) de qualquer lista conhecida (`erro`, `erros`, `errors`). */
function firstOfficialError(
  json: Record<string, unknown>,
): { code: string; message: string } | null {
  for (const key of ['erro', 'erros', 'errors']) {
    const list = json[key];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      if (!isObject(item)) {
        continue;
      }
      const code = item.codigo ?? item.code;
      const message = item.descricao ?? item.mensagem ?? item.message;
      if (typeof code === 'string' && ERROR_CODE.test(code)) {
        return { code, message: typeof message === 'string' ? message.slice(0, 200) : '' };
      }
    }
  }
  return null;
}

/** Interpreta a resposta do `POST /nfse`. Conservador: so conclui com evidencia completa. */
export function interpretEmissionResponse(status: number, body: string): EmissionOutcome {
  const json = parseJson(body);
  if (status === 200 || status === 201) {
    const chave = json?.chaveAcesso;
    const xml = decodeGzipBase64(json?.nfseXmlGZipB64);
    if (typeof chave !== 'string' || !CHAVE.test(chave) || xml === null) {
      return { kind: 'uncertain', reason: 'sucesso_sem_chave_ou_xml_valido' };
    }
    if (!xml.includes(`Id="NFS${chave}"`)) {
      return { kind: 'uncertain', reason: 'xml_nao_corresponde_a_chave' };
    }
    return { kind: 'authorized', chave, nfseXml: xml };
  }
  if (status === 400 || status === 422) {
    const error = json === null ? null : firstOfficialError(json);
    return error === null
      ? { kind: 'uncertain', reason: 'recusa_sem_codigo_oficial' }
      : { kind: 'rejected', code: error.code, message: error.message };
  }
  if (status === 401 || status === 403 || status === 429) {
    // O pedido foi barrado na borda (autenticacao, limite de taxa), antes de gerar documento.
    // Ainda assim nao e certeza absoluta sem o contrato: tratado como nao enviado so se o corpo
    // nao trouxer nada de documento.
    return json?.chaveAcesso === undefined
      ? { kind: 'not_sent', reason: `http_${String(status)}` }
      : { kind: 'uncertain', reason: `http_${String(status)}_com_documento` };
  }
  return { kind: 'uncertain', reason: `http_${String(status)}` };
}

export type DpsLookup =
  | { readonly kind: 'found'; readonly chave: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unknown' };

/** `GET /dps/{id}`: devolve a chave de acesso da NFS-e gerada a partir da DPS, se houver. */
export function interpretDpsLookup(status: number, body: string): DpsLookup {
  if (status === 200) {
    const chave = parseJson(body)?.chaveAcesso;
    return typeof chave === 'string' && CHAVE.test(chave)
      ? { kind: 'found', chave }
      : { kind: 'unknown' };
  }
  return status === 404 ? { kind: 'not_found' } : { kind: 'unknown' };
}

/** `GET /nfse/{chave}`: o XML da NFS-e. */
export function interpretNfseFetch(
  status: number,
  body: string,
  chave: string,
): { readonly kind: 'ok'; readonly nfseXml: string } | { readonly kind: 'unknown' } {
  if (status !== 200) {
    return { kind: 'unknown' };
  }
  const xml = decodeGzipBase64(parseJson(body)?.nfseXmlGZipB64);
  return xml !== null && xml.includes(`Id="NFS${chave}"`)
    ? { kind: 'ok', nfseXml: xml }
    : { kind: 'unknown' };
}
