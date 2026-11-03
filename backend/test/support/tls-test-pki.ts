import { generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';

/**
 * PKI FICTICIA para testes de TLS/mTLS: autoridades certificadoras e certificados gerados NA HORA, em memoria, que
 * nao valem em lugar nenhum. Nenhum certificado real (nem o da Quasar) e usado, e nada disto vira arquivo versionado.
 */
export interface Issued {
  readonly cert: forge.pki.Certificate;
  readonly certPem: string;
  readonly keyPem: string;
  readonly key: forge.pki.rsa.PrivateKey;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function newKey(): { keyPem: string; key: forge.pki.rsa.PrivateKey } {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  return { keyPem, key: forge.pki.privateKeyFromPem(keyPem) };
}

interface Options {
  readonly cn: string;
  /** Emissor; ausente = autoassinado. */
  readonly issuer?: Issued;
  readonly ca?: boolean;
  readonly usage?: 'client' | 'server';
  readonly dns?: readonly string[];
  readonly ips?: readonly string[];
  readonly notBefore?: Date;
  readonly notAfter?: Date;
}

export function issue(options: Options): Issued {
  const { keyPem, key } = newKey();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = randomBytes(8).toString('hex');
  const now = Date.now();
  cert.validity.notBefore = options.notBefore ?? new Date(now - DAY_MS);
  cert.validity.notAfter = options.notAfter ?? new Date(now + 30 * DAY_MS);
  const subject = [
    { name: 'commonName', value: options.cn },
    { name: 'organizationName', value: 'PKI Ficticia de Teste' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(options.issuer === undefined ? subject : options.issuer.cert.subject.attributes);

  const extensions: unknown[] = [];
  if (options.ca === true) {
    extensions.push(
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
    );
  } else {
    extensions.push({ name: 'basicConstraints', cA: false });
    extensions.push({ name: 'keyUsage', digitalSignature: true, keyEncipherment: true });
    extensions.push(
      options.usage === 'client'
        ? { name: 'extKeyUsage', clientAuth: true }
        : { name: 'extKeyUsage', serverAuth: true },
    );
  }
  const altNames = [
    ...(options.dns ?? []).map((value) => ({ type: 2, value })),
    ...(options.ips ?? []).map((ip) => ({ type: 7, ip })),
  ];
  if (altNames.length > 0) {
    extensions.push({ name: 'subjectAltName', altNames });
  }
  cert.setExtensions(extensions);
  cert.sign(options.issuer?.key ?? key, forge.md.sha256.create());
  return { cert, certPem: forge.pki.certificateToPem(cert), keyPem, key };
}

/** `.pfx` (PKCS#12) com a folha e os certificados informados, na ORDEM dada (para testar a ordenacao da cadeia). */
export function toPfx(leaf: Issued, others: readonly Issued[], password: string): Buffer {
  const certificates = [...others.map((item) => item.cert), leaf.cert];
  const p12 = forge.pkcs12.toPkcs12Asn1(leaf.key, certificates, password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}
