import { readFileSync } from 'node:fs';
import forge from 'node-forge';

/** Certificado de transmissao/assinatura ja aberto, SO em memoria do backend. */
export interface NfseCertificate {
  readonly privateKeyPem: string;
  readonly certificatePem: string;
  /**
   * Intermediarias em PEM, na ORDEM da cadeia (a que emitiu a folha primeiro, depois a que emitiu esta...), SEM a
   * folha e SEM a raiz autoassinada. Certificados do `.pfx` que nao pertencem a cadeia da folha ficam de fora.
   * E o que o cliente mTLS apresenta ao servidor logo depois da folha (`[certificatePem, ...chainPem]`).
   */
  readonly chainPem: readonly string[];
  readonly notBefore: Date;
  readonly notAfter: Date;
  /** CNPJ do titular (OtherName 2.16.76.1.3.3 da ICP-Brasil), 14 digitos; `null` se a extensao faltar. */
  readonly cnpj: string | null;
  /** CPF do responsavel (OtherName 2.16.76.1.3.1: data de nascimento + CPF), 11 digitos; ou `null`. */
  readonly cpf: string | null;
}

/** Erro de certificado com codigo fixo: a mensagem nunca carrega caminho, senha nem conteudo. */
export class NfseCertificateError extends Error {
  constructor(
    readonly code:
      | 'arquivo_ilegivel'
      | 'senha_ou_formato_invalido'
      | 'sem_chave_privada'
      | 'expirado'
      | 'ainda_nao_valido',
  ) {
    super(`certificado indisponivel: ${code}`);
    this.name = 'NfseCertificateError';
  }
}

/** Autoassinado = raiz (o emissor e o proprio titular). */
const isSelfSigned = (cert: forge.pki.Certificate): boolean =>
  cert.subject.hash === cert.issuer.hash;

/** `parent` assinou `child`? Falha de verificacao (ou certificado malformado) conta como "nao". */
function signedBy(parent: forge.pki.Certificate, child: forge.pki.Certificate): boolean {
  try {
    return parent.verify(child);
  } catch {
    return false;
  }
}

/**
 * Intermediarias na ordem da cadeia: parte da folha e sobe pelo emissor, verificando a ASSINATURA de cada elo
 * (nao so o nome). Para na raiz (que NAO entra: o servidor a tem) ou quando nao ha mais elo. Limite de 8 niveis
 * contra ciclos. O que sobrar no `.pfx` (certificados sem relacao com a folha) e descartado.
 */
function orderedIntermediates(
  leaf: forge.pki.Certificate,
  all: readonly forge.pki.Certificate[],
): forge.pki.Certificate[] {
  const chain: forge.pki.Certificate[] = [];
  let current = leaf;
  for (let depth = 0; depth < 8 && !isSelfSigned(current); depth += 1) {
    const parent = all.find(
      (candidate) =>
        candidate !== leaf &&
        !chain.includes(candidate) &&
        candidate.subject.hash === current.issuer.hash &&
        signedBy(candidate, current),
    );
    if (parent === undefined || isSelfSigned(parent)) {
      break;
    }
    chain.push(parent);
    current = parent;
  }
  return chain;
}

const OID_CNPJ = '2.16.76.1.3.3';
const OID_CPF_RESPONSAVEL = '2.16.76.1.3.1';
const SAN_EXTENSION = '2.5.29.17';

/** Valor de cada OtherName da extensao subjectAltName, por OID. */
function otherNames(certificate: forge.pki.Certificate): Map<string, string> {
  const found = new Map<string, string>();
  const extension = certificate.extensions.find(
    (item: { id?: string }) => item.id === SAN_EXTENSION,
  ) as { value?: string } | undefined;
  if (extension?.value === undefined) {
    return found;
  }
  try {
    const sequence = forge.asn1.fromDer(extension.value);
    for (const general of sequence.value as forge.asn1.Asn1[]) {
      // otherName = [0] IMPLICIT SEQUENCE { type-id OID, value [0] EXPLICIT ANY }
      if (
        Number(general.tagClass) !== Number(forge.asn1.Class.CONTEXT_SPECIFIC) ||
        Number(general.type) !== 0
      ) {
        continue;
      }
      const [oidNode, wrapper] = general.value as forge.asn1.Asn1[];
      if (oidNode === undefined || wrapper === undefined) {
        continue;
      }
      const oid = forge.asn1.derToOid(oidNode.value as string);
      const inner = Array.isArray(wrapper.value) ? wrapper.value[0] : wrapper;
      if (typeof inner.value === 'string') {
        found.set(oid, inner.value);
      }
    }
  } catch {
    // Extensao malformada: tratada como ausente (quem usa o CNPJ falha fechado).
  }
  return found;
}

/** Abre um `.pfx` (PKCS#12) a partir dos bytes. Para teste e para `loadNfseCertificate`. */
export function openPfx(pfx: Buffer, password: string, now: Date = new Date()): NfseCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))),
      false,
      password,
    );
  } catch {
    throw new NfseCertificateError('senha_ou_formato_invalido');
  }
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ]?.[0] ?? p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certificates = (
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  )
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => cert !== undefined);
  if (keyBag?.key === undefined) {
    throw new NfseCertificateError('sem_chave_privada');
  }
  const key = keyBag.key;
  // A folha e a que casa com a chave privada; as demais sao a cadeia.
  const leaf = certificates.find(
    (cert) => (cert.publicKey as forge.pki.rsa.PublicKey).n.compareTo(key.n) === 0,
  );
  if (leaf === undefined) {
    throw new NfseCertificateError('sem_chave_privada');
  }
  if (leaf.validity.notAfter.getTime() < now.getTime()) {
    throw new NfseCertificateError('expirado');
  }
  if (leaf.validity.notBefore.getTime() > now.getTime()) {
    throw new NfseCertificateError('ainda_nao_valido');
  }
  const names = otherNames(leaf);
  const cnpj = names.get(OID_CNPJ) ?? null;
  const responsavel = names.get(OID_CPF_RESPONSAVEL) ?? null;
  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certificatePem: forge.pki.certificateToPem(leaf),
    chainPem: orderedIntermediates(leaf, certificates).map((cert) =>
      forge.pki.certificateToPem(cert),
    ),
    notBefore: leaf.validity.notBefore,
    notAfter: leaf.validity.notAfter,
    cnpj: cnpj !== null && /^\d{14}$/.test(cnpj) ? cnpj : null,
    // O valor e DDMMAAAA (8) + CPF (11) + outros: o CPF ocupa as posicoes 8 a 18.
    cpf: responsavel !== null && /^\d{19,}/.test(responsavel) ? responsavel.slice(8, 19) : null,
  };
}

/** Le o `.pfx` do disco e o abre. Falhas viram `NfseCertificateError` (sem caminho nem senha). */
export function loadNfseCertificate(
  path: string,
  password: string,
  now: Date = new Date(),
): NfseCertificate {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new NfseCertificateError('arquivo_ilegivel');
  }
  return openPfx(bytes, password, now);
}
