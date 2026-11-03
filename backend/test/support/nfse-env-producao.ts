/**
 * Liga a NFS-e nos e2e em PRODUCAO REAL (Sefin oficial, sem servidor de teste) com TUDO ligado: NFSE_ENABLED=true e
 * NFSE_WIRE_CONTRACT_CONFIRMED=true, mas SEM `NFSE_PRODUCAO_AUTORIZACAO`. E o cenario que a autorizacao propria
 * existe para barrar. Certificado FICTICIO gerado na hora. Importar ANTES do `app.module.ts`.
 *
 * ATENCAO: se o portao falhasse, a aplicacao tentaria falar com a Sefin de producao. O teste que importa este
 * arquivo intercepta `https.request` ANTES de subir a aplicacao, entao nenhuma conexao pode sair.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestPki } from './nfse-test-pki';

export const NFSE_PRESTADOR_CNPJ_PRODUCAO = '11222333000181';

const pki = createTestPki({ cnpj: NFSE_PRESTADOR_CNPJ_PRODUCAO });
const dir = mkdtempSync(join(tmpdir(), 'vastaflow-nfse-e2e-producao-'));
const pfxPath = join(dir, 'ficticio.pfx');
writeFileSync(pfxPath, pki.pfx);

process.env.NFSE_ENABLED = 'true';
process.env.NFSE_AMBIENTE = 'producao';
process.env.NFSE_WIRE_CONTRACT_CONFIRMED = 'true';
// Sem NFSE_API_BASE_URL (destino = Sefin oficial) e SEM NFSE_PRODUCAO_AUTORIZACAO (padrao: desativada).
delete process.env.NFSE_API_BASE_URL;
delete process.env.NFSE_PRODUCAO_AUTORIZACAO;
process.env.NFSE_CERT_PFX_PATH = pfxPath;
process.env.NFSE_CERT_PFX_PASSWORD = pki.password;
process.env.NFSE_PRESTADOR_CNPJ = NFSE_PRESTADOR_CNPJ_PRODUCAO;
process.env.NFSE_PRESTADOR_IM = '123456';
process.env.NFSE_PRESTADOR_NOME = 'Empresa Ficticia Ltda';
process.env.NFSE_MUNICIPIO_EMISSOR_IBGE = '3106200';
process.env.NFSE_OPCAO_SIMPLES = '3';
process.env.NFSE_REGIME_APURACAO_SN = '1';
process.env.NFSE_REGIME_ESPECIAL_TRIBUTACAO = '0';
process.env.NFSE_DPS_SERIE = '1';
process.env.NFSE_VALOR_MAXIMO = '5000';
