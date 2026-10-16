// Dados SINTETICOS e conferencia para o teste de restauracao (scripts/restore-test.sh).
// Roda DENTRO de um container node na rede da stack descartavel; so fala com `backend:3000`.
//
//   node driver.mjs seed     cria dados pela API real (login, lancamentos, documento) e imprime a "digital"
//   node driver.mjs verify   usa o backend da stack RESTAURADA para ler tudo de volta e compara com a digital
//
// Credenciais sinteticas chegam por ambiente (RT_ADMIN_EMAIL, RT_ADMIN_PASSWORD); nada e gravado em arquivo.
import { createHash } from 'node:crypto';

const BASE = process.env.RT_BACKEND ?? 'http://backend:3000';
const EMAIL = process.env.RT_ADMIN_EMAIL;
const PASSWORD = process.env.RT_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('RT_ADMIN_EMAIL/RT_ADMIN_PASSWORD ausentes');
  process.exit(2);
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(`${BASE}/health/readiness`);
      if (response.ok) return;
    } catch {
      // ainda subindo
    }
    await sleep(2000);
  }
  throw new Error('backend nao ficou pronto');
}

async function login() {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, senha: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login recusado (${response.status})`);
  return (await response.json()).accessToken;
}

const auth = (token) => ({ authorization: `Bearer ${token}` });

// Conteudo fixo e conhecido: o hash recuperado depois da restauracao precisa ser identico.
const DOC_CONTENT = Buffer.from(
  'codigo;descricao;valor\n' + Array.from({ length: 200 }, (_, i) => `${i};linha sintetica ${i};${i * 3}.50`).join('\n') + '\n',
  'utf8',
);
const ENTRIES = [
  { tipo: 'RECEITA', descricao: 'Receita sintetica A', valor: 1500.5, data: '2026-10-01', categoria: 'teste' },
  { tipo: 'RECEITA', descricao: 'Receita sintetica B', valor: 2300.0, data: '2026-10-02', categoria: 'teste' },
  { tipo: 'DESPESA', descricao: 'Despesa sintetica C', valor: 410.25, data: '2026-10-03', categoria: 'teste' },
  { tipo: 'DESPESA', descricao: 'Despesa sintetica D', valor: 99.99, data: '2026-10-04', categoria: 'teste' },
  { tipo: 'RECEITA', descricao: 'Receita sintetica E', valor: 0.07, data: '2026-10-05', categoria: 'teste' },
];
const cents = (entries) => entries.reduce((sum, e) => sum + Math.round(Number(e.valor) * 100) * (e.tipo === 'RECEITA' ? 1 : -1), 0);

async function seed() {
  await waitReady();
  const token = await login();
  for (const entry of ENTRIES) {
    const response = await fetch(`${BASE}/finance/entries`, {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (response.status !== 201) throw new Error(`lancamento recusado (${response.status}): ${await response.text()}`);
  }
  const form = new FormData();
  form.append('arquivo', new Blob([DOC_CONTENT], { type: 'text/csv' }), 'sintetico.csv');
  form.append('nome', 'Documento sintetico');
  form.append('categoria', 'teste');
  const upload = await fetch(`${BASE}/documents`, { method: 'POST', headers: auth(token), body: form });
  if (upload.status !== 201) throw new Error(`upload recusado (${upload.status}): ${await upload.text()}`);
  console.log(
    JSON.stringify({
      lancamentos: ENTRIES.length,
      saldoCentavos: cents(ENTRIES),
      documentoSha256: sha256(DOC_CONTENT),
      documentoBytes: DOC_CONTENT.length,
    }),
  );
}

async function verify() {
  const expected = JSON.parse(process.env.RT_EXPECTED ?? '{}');
  await waitReady();
  const token = await login(); // o usuario ADMIN veio do backup do MySQL
  const entriesResponse = await fetch(`${BASE}/finance/entries?limit=100`, { headers: auth(token) });
  const page = await entriesResponse.json();
  const synthetic = page.items.filter((e) => e.categoria === 'teste');
  const result = {
    loginComUsuarioRestaurado: true,
    lancamentos: synthetic.length,
    saldoCentavos: cents(synthetic),
  };
  const docs = await (await fetch(`${BASE}/documents?limit=50`, { headers: auth(token) })).json();
  const doc = docs.items.find((d) => d.nomeOriginal === 'sintetico.csv');
  if (!doc) throw new Error('documento nao encontrado apos a restauracao');
  const download = await fetch(`${BASE}/documents/${doc.id}/download`, { headers: auth(token) });
  if (!download.ok) throw new Error(`download falhou (${download.status})`);
  const bytes = Buffer.from(await download.arrayBuffer());
  result.documentoSha256 = sha256(bytes);
  result.documentoBytes = bytes.length;

  const ok =
    result.lancamentos === expected.lancamentos &&
    result.saldoCentavos === expected.saldoCentavos &&
    result.documentoSha256 === expected.documentoSha256 &&
    result.documentoBytes === expected.documentoBytes;
  console.log(JSON.stringify({ ...result, conferecomOriginal: ok }));
  process.exit(ok ? 0 : 1);
}

const mode = process.argv[2];
try {
  if (mode === 'seed') await seed();
  else if (mode === 'verify') await verify();
  else throw new Error('use: seed | verify');
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
}
