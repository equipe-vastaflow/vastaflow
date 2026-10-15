import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

/**
 * Certificado FICTICIO, autoassinado, SO para testes. Imita o que a Sefin Nacional le de um e-CNPJ da
 * ICP-Brasil (OtherName 2.16.76.1.3.3 com o CNPJ), mas NAO e da ICP-Brasil e nao e aceito por nenhum
 * servidor real. A chave e gerada na hora e descartada: nada disto vai para o repositorio como arquivo.
 */
export interface TestPki {
  readonly pfx: Buffer;
  readonly password: string;
  readonly certificatePem: string;
  readonly privateKeyPem: string;
}

export function createTestPki(options: {
  readonly cnpj?: string | null;
  readonly password?: string;
  readonly notBefore?: Date;
  readonly notAfter?: Date;
}): TestPki {
  const password = options.password ?? 'senha-de-teste-ficticia';
  const { privateKey: nodeKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = forge.pki.privateKeyFromPem(
    nodeKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  );
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  certificate.serialNumber = '01';
  certificate.validity.notBefore = options.notBefore ?? new Date(Date.now() - 86_400_000);
  certificate.validity.notAfter = options.notAfter ?? new Date(Date.now() + 365 * 86_400_000);
  const subject = [
    { name: 'commonName', value: 'EMPRESA FICTICIA DE TESTE LTDA' },
    { name: 'organizationName', value: 'Teste Sem Validade Juridica' },
  ];
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  const extensions: unknown[] = [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ];
  if (options.cnpj !== null) {
    const cnpj = options.cnpj ?? '11222333000181';
    const otherName = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer('2.16.76.1.3.3').getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.UTF8, false, cnpj),
      ]),
    ]);
    const names = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      otherName,
    ]);
    extensions.push({
      id: '2.5.29.17',
      critical: false,
      value: forge.asn1.toDer(names).getBytes(),
    });
  }
  certificate.setExtensions(extensions);
  certificate.sign(privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], password, { algorithm: '3des' });
  return {
    pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'),
    password,
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
  };
}
