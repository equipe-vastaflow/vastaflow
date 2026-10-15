import { SignedXml } from 'xml-crypto';
import type { NfseCertificate } from './nfse-certificate';

/**
 * Algoritmos da assinatura XML (XMLDSig). A Sefin Nacional exige assinatura da DPS com o
 * certificado do emitente (regras E0714 a E0718 do Anexo I), mas os documentos oficiais obtidos
 * NAO fixam o algoritmo: estes valores sao a ESCOLHA do projeto (RSA-SHA256, C14N inclusiva,
 * enveloped) e precisam ser confirmados em producao restrita antes de qualquer uso real.
 */
export const DSIG_SIGNATURE_ALGORITHM = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
export const DSIG_DIGEST_ALGORITHM = 'http://www.w3.org/2001/04/xmlenc#sha256';
export const DSIG_CANONICALIZATION = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const DSIG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/**
 * Assina a DPS (`infDPS`, referenciada por `#Id`) com assinatura ENVELOPADA: o `Signature` entra
 * como ultimo filho de `DPS`, depois de `infDPS`, como no esquema (`TCDPS`).
 */
export function signDps(
  xml: string,
  certificate: Pick<NfseCertificate, 'privateKeyPem' | 'certificatePem'>,
): string {
  const signature = new SignedXml({
    privateKey: certificate.privateKeyPem,
    publicCert: certificate.certificatePem,
    signatureAlgorithm: DSIG_SIGNATURE_ALGORITHM,
    canonicalizationAlgorithm: DSIG_CANONICALIZATION,
    getKeyInfoContent: (args) =>
      SignedXml.getKeyInfoContent({ publicCert: certificate.certificatePem, prefix: args?.prefix }),
  });
  signature.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: [DSIG_ENVELOPED, DSIG_CANONICALIZATION],
    digestAlgorithm: DSIG_DIGEST_ALGORITHM,
  });
  signature.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='DPS']", action: 'append' },
  });
  return signature.getSignedXml();
}

/** Confere a assinatura de uma DPS assinada com o certificado informado (usado em testes e na auditoria). */
export function verifyDpsSignature(signedXml: string, certificatePem: string): boolean {
  const verifier = new SignedXml({ publicCert: certificatePem });
  const match = /<Signature[\s\S]*<\/Signature>/.exec(signedXml);
  if (match === null) {
    return false;
  }
  verifier.loadSignature(match[0]);
  try {
    return verifier.checkSignature(signedXml);
  } catch {
    return false;
  }
}
