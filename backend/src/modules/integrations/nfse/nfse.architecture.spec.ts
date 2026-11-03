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

  it.each(['producao-2026-02-09', 'restrita-2026-10-20'])(
    'o pacote de esquemas %s inclui a DPS, os tipos e a assinatura XML',
    (pasta) => {
      expect(readdirSync(join(__dirname, 'xsd', pasta)).sort()).toEqual(
        expect.arrayContaining([
          'DPS_v1.01.xsd',
          'tiposComplexos_v1.01.xsd',
          'tiposSimples_v1.01.xsd',
          'xmldsig-core-schema.xsd',
        ]),
      );
    },
  );

  it('nenhum codigo fiscal (servico, NBS, CST, classificacao, operacao) esta embutido no codigo: so em perfil externo aprovado', () => {
    for (const { arquivo, codigo } of NFSE) {
      // Literais de 6 ou 9 digitos sao o formato de cTribNac, cClassTrib, cIndOp e cNBS. Em codigo de producao
      // so haveria um se alguem fixasse um padrao tributario: a regra do projeto e nunca ter padrao.
      expect({
        arquivo,
        literais: semComentarios(codigo).match(/['"]\d{6}['"]|['"]\d{9}['"]/g) ?? [],
      }).toEqual({ arquivo, literais: [] });
    }
  });

  it('o arquivo de perfis fiscais vem so da configuracao e nunca do repositorio', () => {
    expect(readdirSync(__dirname).filter((nome) => /perfis?.*\.json$/i.test(nome))).toEqual([]);
    const compose = readFileSync(join(REPO_ROOT, 'docker-compose.production.yml'), 'utf8');
    expect(compose).toContain('NFSE_PERFIS_FISCAIS_PATH: ${NFSE_PERFIS_FISCAIS_PATH:-}');
    // O caminho do arquivo so e lido na configuracao e no servico (mesma regra do certificado).
    expect(fonte('nfse-settings.ts')).toContain('perfisFiscaisPath');
  });

  it('o comando do Telegram e fino: so fala com o servico, sem regra fiscal, perfil, XML nem acesso a configuracao', () => {
    const imports = importsDe(
      NFSE.find(({ arquivo }) => arquivo === 'nfse.commands.ts')?.codigo ?? '',
    )
      .filter((origem) => origem.startsWith('./'))
      .sort();
    // Nenhum modulo de perfil, builder, configuracao ou transporte: so o estado da emissao e o servico.
    expect(imports).toEqual(['./nfse-emission.entity', './nfse.service']);
    expect(fonte('nfse.commands.ts')).not.toMatch(/process\.env|config\.get|certPfx|prestadorCnpj/);
  });

  it('a autorizacao de producao: decidida so na configuracao, aplicada no cliente HTTP, invisivel ao comando', () => {
    const usam = (padrao: RegExp): string[] =>
      NFSE.filter(({ codigo }) => padrao.test(semComentarios(codigo))).map(
        ({ arquivo }) => arquivo,
      );

    expect(usam(/NFSE_PRODUCAO_AUTORIZACAO/).sort()).toEqual([
      'nfse-settings.ts',
      'nfse.service.ts',
    ]);
    expect(usam(/producaoAutorizada/).sort()).toEqual([
      'nfse-api.client.ts',
      'nfse-settings.ts',
      'nfse.service.ts',
    ]);
    expect(usam(/producaoAutorizacaoEsperada/)).toEqual(['nfse-settings.ts']);
    expect(fonte('nfse.commands.ts')).not.toMatch(/producaoAutorizada|NFSE_PRODUCAO_AUTORIZACAO/);
  });

  it('o portao de producao vem ANTES de qualquer acesso a rede, no transporte e em toda chamada do cliente', () => {
    const cliente = fonte('nfse-api.client.ts');
    const transporte = /export function createTransport[\s\S]*?\n}\n/.exec(cliente)?.[0] ?? '';
    const portao = transporte.indexOf(
      'isProductionUrl(request.url) && !settings.producaoAutorizada',
    );
    const rede = transporte.search(/\bsend\(|https\.request|http\.request/);

    expect(portao).toBeGreaterThan(-1);
    expect(portao).toBeLessThan(rede);
    // Cada operacao do cliente confere o portao ANTES de chamar o transporte.
    for (const operacao of ['async emit(', 'async findByDps(', 'async fetchNfse(']) {
      const corpo = cliente.slice(cliente.indexOf(operacao));
      const antes = corpo.slice(0, corpo.indexOf('this.transport('));
      expect(antes).toContain('this.assertProduction(url)');
    }
  });

  it('o comando nao concede permissao: nfse:emit e nfse:read so existem no ADMIN por padrao', () => {
    const catalogo = readFileSync(join(__dirname, '..', '..', 'roles', 'role-defaults.ts'), 'utf8');
    expect(semComentarios(catalogo)).not.toMatch(/Nfse(Emit|Read)|nfse:(emit|read)/);
  });
});
