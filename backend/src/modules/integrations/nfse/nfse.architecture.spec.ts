import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function fontes(): { arquivo: string; codigo: string }[] {
  return readdirSync(__dirname)
    .filter((a) => a.endsWith('.ts') && !a.endsWith('.spec.ts'))
    .map((arquivo) => ({ arquivo, codigo: readFileSync(join(__dirname, arquivo), 'utf8') }));
}
const semComentarios = (codigo: string): string =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsDe = (codigo: string): string[] =>
  [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem ?? '');
const fonte = (nome: string): string =>
  semComentarios(fontes().find(({ arquivo }) => arquivo === nome)?.codigo ?? '');

const NFSE = fontes();
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

describe('Arquitetura da NFS-e', () => {
  it('ha fontes para verificar', () => {
    expect(NFSE.length).toBeGreaterThanOrEqual(12);
  });

  it('SO o cliente abre conexao de rede (unico ponto), e ninguem usa fetch', () => {
    const comRede = NFSE.filter(({ codigo }) =>
      /from 'node:(https?|net|tls|dgram)'|\bfetch\(/.test(semComentarios(codigo)),
    ).map(({ arquivo }) => arquivo);
    expect(comRede).toEqual(['nfse-api.client.ts']);
  });

  it('nenhum fonte registra log, le process.env ou imprime: certificado e senha nao tem por onde vazar', () => {
    for (const { arquivo, codigo } of NFSE) {
      expect({
        arquivo,
        uso: /process\.env|console\.|Logger|\.log\(|\.warn\(|\.error\(/.test(
          semComentarios(codigo),
        ),
      }).toEqual({
        arquivo,
        uso: false,
      });
    }
  });

  it('senha e caminho do .pfx so existem no servico/configuracao; a chave privada so chega ao cliente (mTLS) e ao assinador', () => {
    for (const { arquivo, codigo } of NFSE) {
      if (['nfse-settings.ts', 'nfse.service.ts'].includes(arquivo)) {
        continue;
      }
      expect({ arquivo, usa: /certPfxPassword|certPfxPath/.test(semComentarios(codigo)) }).toEqual({
        arquivo,
        usa: false,
      });
    }
    const comChave = NFSE.filter(({ codigo }) => /privateKeyPem/.test(semComentarios(codigo))).map(
      ({ arquivo }) => arquivo,
    );
    expect(comChave.sort()).toEqual([
      'nfse-api.client.ts',
      'nfse-certificate.ts',
      'nfse-signer.ts',
    ]);
    expect(fonte('nfse.commands.ts')).not.toMatch(/nfse-(api\.client|certificate|signer)/);
  });

  it('nao expoe rota HTTP: emitir nota nao e uma API aberta', () => {
    for (const { codigo } of NFSE) {
      expect(semComentarios(codigo)).not.toMatch(/@(Controller|Get|Post|Put|Patch|Delete)\(/);
    }
  });

  it('nao depende de modulo de negocio, do Plantae, do n8n nem de canal algum', () => {
    for (const { codigo } of NFSE) {
      expect(
        importsDe(codigo).filter((origem) =>
          /(^|\/)(finance|documents|plantae|users|settings|notifications|n8n|telegram|telegram-ingest|whatsapp)(\/|$)/.test(
            origem,
          ),
        ),
      ).toEqual([]);
    }
  });

  it('toda mudanca de estado e UPDATE condicional: so a criacao usa save()', () => {
    const repositorio = fonte('nfse-emissions.repository.ts');
    expect(repositorio.match(/\.save\(/g)).toHaveLength(1);
    expect(repositorio).toMatch(/async createPending[\s\S]*\.save\(/);
    // As transicoes sempre carregam o estado de origem no criterio.
    expect(repositorio).toMatch(/async transition[\s\S]*\{ id, status: from \}/);
    expect(repositorio).toMatch(
      /async consumeConfirmation[\s\S]*status: NfseEmissionStatus\.AguardandoConfirmacao/,
    );
  });

  it('o servico nunca reenvia: ha um unico ponto de emissao e ele so existe em transmit()', () => {
    const servico = fonte('nfse.service.ts');
    expect(servico.match(/\.emit\(/g)).toHaveLength(1);
    expect(servico).toMatch(/private async transmit[\s\S]*client\.emit\(signed\)/);
    // Reconciliar e consultar nunca chamam emit.
    const reconcile =
      /private async reconcile[\s\S]*?private confirmationHash/.exec(servico)?.[0] ?? '';
    expect(reconcile).not.toMatch(/\.emit\(/);
    expect(reconcile).toMatch(/findByDps/);
  });

  it('o cliente nao segue redirecionamento nem aceita destino que nao seja o configurado', () => {
    const cliente = fonte('nfse-api.client.ts');
    expect(cliente).not.toMatch(/followRedirects|maxRedirects|redirect:\s*'follow'/);
    expect(cliente).toContain('this.settings.baseUrl');
    expect(cliente).toContain('encodeURIComponent');
  });

  it('as variaveis NFSE_* so chegam ao backend no Compose (nem n8n, nem frontend, nem migrate)', () => {
    const compose = readFileSync(join(REPO_ROOT, 'docker-compose.production.yml'), 'utf8').split(
      /\r?\n/,
    );
    let servico = '';
    const donos = new Set<string>();
    for (const linha of compose) {
      const novo = /^ {2}([a-z0-9-]+):\s*$/.exec(linha);
      if (novo !== null) {
        servico = novo[1] ?? '';
      }
      if (/NFSE_[A-Z_]+:/.test(linha) && !/^\s*#/.test(linha)) {
        donos.add(servico);
      }
    }
    expect([...donos]).toEqual(['backend']);
  });

  it('o pacote de esquemas inclui a DPS, os tipos e a assinatura XML', () => {
    expect(readdirSync(join(__dirname, 'xsd')).sort()).toEqual(
      expect.arrayContaining([
        'DPS_v1.01.xsd',
        'tiposComplexos_v1.01.xsd',
        'tiposSimples_v1.01.xsd',
        'xmldsig-core-schema.xsd',
      ]),
    );
  });
});
