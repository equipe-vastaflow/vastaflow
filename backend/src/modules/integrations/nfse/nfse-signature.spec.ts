import { createTestPki } from '../../../../test/support/nfse-test-pki';
import { NfseCertificateError, openPfx } from './nfse-certificate';
import { buildNfseInput } from './nfse-dps';
import { signDps, verifyDpsSignature } from './nfse-signer';
import { buildDpsXml } from './nfse-xml.builder';
import { validateDpsXml } from './nfse-xsd.validator';

const settings = {
  tpAmb: 2 as const,
  municipioEmissor: '3106200',
  prestadorCnpj: '11222333000181',
  prestadorIm: '123456',
  prestadorNome: 'Empresa Ficticia Ltda',
  opSimpNac: 3 as const,
  regApTribSN: 1 as const,
  regEspTrib: 0 as const,
  serie: '00001',
  valorMaximo: '10000.00',
};
const NOW = new Date('2026-10-15T15:00:00Z');

function unsignedDps(): string {
  const built = buildNfseInput(
    {
      tomador: '52998224725',
      nome: 'Maria Teste',
      valor: '1500,50',
      servico: '010101',
      desc: 'Servico fficticio',
      iss: '1',
      ret: '1',
      local: '3106200',
      totsn: '12,5',
    },
    settings,
    NOW,
  );
  if (!built.ok) {
    throw new Error('entrada de teste invalida');
  }
  return buildDpsXml(built.input, settings, 7, NOW).xml;
}

describe('certificado (PKCS#12) e assinatura da DPS', () => {
  const pki = createTestPki({});

  it('abre o .pfx, extrai o CNPJ da extensao ICP-Brasil e nao expoe a senha no erro', () => {
    const cert = openPfx(pki.pfx, pki.password);
    expect(cert.cnpj).toBe('11222333000181');
    expect(cert.notAfter.getTime()).toBeGreaterThan(Date.now());
    try {
      openPfx(pki.pfx, 'senha-errada');
      fail('deveria recusar');
    } catch (error) {
      expect(error).toBeInstanceOf(NfseCertificateError);
      expect((error as NfseCertificateError).code).toBe('senha_ou_formato_invalido');
      expect(String((error as Error).message)).not.toContain('senha-errada');
    }
  });

  it('recusa certificado vencido e certificado sem extensao de CNPJ devolve cnpj nulo', () => {
    const expired = createTestPki({
      notAfter: new Date(Date.now() - 1000),
      notBefore: new Date(Date.now() - 2e9),
    });
    expect(() => openPfx(expired.pfx, expired.password)).toThrow(/expirado/);
    const noCnpj = createTestPki({ cnpj: null });
    expect(openPfx(noCnpj.pfx, noCnpj.password).cnpj).toBeNull();
  });

  it('assina a DPS, o XML assinado continua valido no esquema oficial e a assinatura confere', async () => {
    const cert = openPfx(pki.pfx, pki.password);
    const unsigned = unsignedDps();
    expect((await validateDpsXml(unsigned, 'producao-2026-02')).valid).toBe(true);
    const signed = signDps(unsigned, cert);
    expect(signed).toContain('<Signature');
    expect(signed.indexOf('</infDPS>')).toBeLessThan(signed.indexOf('<Signature'));
    expect((await validateDpsXml(signed, 'producao-2026-02')).errors).toEqual([]);
    expect(verifyDpsSignature(signed, cert.certificatePem)).toBe(true);
  });

  it('adulterar qualquer campo depois de assinar invalida a assinatura', () => {
    const cert = openPfx(pki.pfx, pki.password);
    const signed = signDps(unsignedDps(), cert);
    const tampered = signed.replace('<vServ>1500.50</vServ>', '<vServ>9500.50</vServ>');
    expect(tampered).not.toBe(signed);
    expect(verifyDpsSignature(tampered, cert.certificatePem)).toBe(false);
  });

  it('outro certificado nao valida a assinatura', () => {
    const cert = openPfx(pki.pfx, pki.password);
    const other = createTestPki({});
    expect(verifyDpsSignature(signDps(unsignedDps(), cert), other.certificatePem)).toBe(false);
  });
});
