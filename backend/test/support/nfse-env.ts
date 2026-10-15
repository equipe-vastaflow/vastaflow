/**
 * Liga a NFS-e nos e2e, contra uma Sefin FALSA em loopback e um certificado FICTICIO gerado na hora.
 * Importar ANTES do `app.module.ts`. Nenhuma conexao com a Sefin real; nenhum certificado real.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestPki } from './nfse-test-pki';

export const FAKE_SEFIN_PORT = 38790;
export const NFSE_PRESTADOR_CNPJ = '11222333000181';

const pki = createTestPki({ cnpj: NFSE_PRESTADOR_CNPJ });
const dir = mkdtempSync(join(tmpdir(), 'vastaflow-nfse-e2e-'));
const pfxPath = join(dir, 'ficticio.pfx');
writeFileSync(pfxPath, pki.pfx);

export const NFSE_TEST_CERTIFICATE_PEM = pki.certificatePem;

process.env.NFSE_ENABLED = 'true';
process.env.NFSE_AMBIENTE = 'restrita';
process.env.NFSE_API_BASE_URL = `http://127.0.0.1:${String(FAKE_SEFIN_PORT)}`;
process.env.NFSE_CERT_PFX_PATH = pfxPath;
process.env.NFSE_CERT_PFX_PASSWORD = pki.password;
process.env.NFSE_PRESTADOR_CNPJ = NFSE_PRESTADOR_CNPJ;
process.env.NFSE_PRESTADOR_IM = '123456';
process.env.NFSE_PRESTADOR_NOME = 'Empresa Ficticia Ltda';
process.env.NFSE_MUNICIPIO_EMISSOR_IBGE = '3106200';
process.env.NFSE_OPCAO_SIMPLES = '3';
process.env.NFSE_REGIME_APURACAO_SN = '1';
process.env.NFSE_REGIME_ESPECIAL_TRIBUTACAO = '0';
process.env.NFSE_DPS_SERIE = '1';
process.env.NFSE_VALOR_MAXIMO = '5000';
