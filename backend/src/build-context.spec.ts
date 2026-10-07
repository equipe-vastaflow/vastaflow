import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

/**
 * Nenhum arquivo de CODIGO pode ser excluido do repositorio nem do build
 * context por um padrao de ignore.
 *
 * Isto existe porque o problema JA ACONTECEU: o `.gitignore` tinha `storage/`
 * sem barra inicial, e um padrao sem barra no gitignore casa com um diretorio
 * daquele nome em QUALQUER nivel - inclusive
 * `src/modules/documents/storage/`, que e codigo. Dois arquivos de teste da
 * fundacao de documentos (`storage-adapters.spec.ts` e `storage-key.spec.ts`)
 * ficaram fora de todos os commits da Fase B sem ninguem notar: eles rodavam
 * localmente e passavam, e o `git add` os ignorava em silencio.
 *
 * O `.dockerignore` tem semantica DIFERENTE do `.gitignore`, e a diferenca
 * importa aqui: no Docker os padroes sao casados contra o caminho INTEIRO
 * (`filepath.Match` do Go), nao em cada nivel. Logo `storage` no
 * `.dockerignore` casaria apenas com uma entrada na raiz do contexto, e o
 * padrao perigoso la e `**​/storage`. Este teste cobre as duas semanticas.
 */

/** Raiz do projeto backend (este arquivo esta em `src/`). */
const BACKEND = resolve(__dirname, '..');
/** Raiz do repositorio, onde fica o `.gitignore`. */
const REPO = resolve(BACKEND, '..');

/** Diretorio cujo nome colide com um padrao de ignore plausivel. O incidente real. */
const DIRETORIO_SENSIVEL = 'src/modules/documents/storage';

/** Caminhos de codigo, relativos a `backend/`, em formato POSIX. */
function arquivosDeCodigo(relativo: string): string[] {
  const absoluto = join(BACKEND, relativo);
  const encontrados: string[] = [];

  for (const entrada of readdirSync(absoluto, { withFileTypes: true })) {
    const caminho = posix.join(relativo, entrada.name);
    if (entrada.isDirectory()) {
      encontrados.push(...arquivosDeCodigo(caminho));
    } else if (entrada.name.endsWith('.ts')) {
      encontrados.push(caminho);
    }
  }

  return encontrados;
}

interface Padrao {
  readonly original: string;
  readonly negado: boolean;
  readonly regex: RegExp;
}

/**
 * Traduz um padrao de ignore em expressao regular.
 *
 * `ancoradoEmQualquerNivel` reproduz a regra do gitignore: um padrao SEM barra
 * no meio casa em qualquer nivel da arvore. O Docker nao tem essa regra, e por
 * isso o mesmo texto pode ser seguro num arquivo e perigoso no outro.
 */
function compilar(linha: string, ancoradoEmQualquerNivel: boolean): Padrao | null {
  let texto = linha.trim();
  if (texto === '' || texto.startsWith('#')) {
    return null;
  }

  const negado = texto.startsWith('!');
  if (negado) {
    texto = texto.slice(1);
  }

  const soDiretorio = texto.endsWith('/');
  if (soDiretorio) {
    texto = texto.slice(0, -1);
  }

  const ancoradoNaRaiz = texto.startsWith('/');
  if (ancoradoNaRaiz) {
    texto = texto.slice(1);
  }

  // Um padrao com barra no meio e sempre relativo a raiz, nas duas semanticas.
  const temBarraInterna = texto.includes('/');

  // `**` e tratado dividindo o segmento nele, em vez de por sentinela: uma
  // sentinela de caractere de controle faria o lint do projeto reclamar com
  // razao, e o projeto nao tem nenhum `eslint-disable`.
  const traduzirSegmento = (parte: string): string =>
    parte === '**'
      ? '.*'
      : parte
          .split('**')
          .map((pedaco) =>
            pedaco
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '[^/]*')
              .replace(/\?/g, '[^/]'),
          )
          .join('.*');

  const corpo = texto.split('/').map(traduzirSegmento).join('/');

  const prefixo =
    ancoradoNaRaiz || temBarraInterna || !ancoradoEmQualquerNivel ? '' : '(?:.*/)?';

  // `(?:/.*)?` faz o padrao cobrir tambem o conteudo do diretorio que ele casa.
  return { original: linha.trim(), negado, regex: new RegExp(`^${prefixo}${corpo}(?:/.*)?$`) };
}

function carregarPadroes(arquivo: string, ancoradoEmQualquerNivel: boolean): Padrao[] {
  return readFileSync(arquivo, 'utf8')
    .split(/\r?\n/)
    .map((linha) => compilar(linha, ancoradoEmQualquerNivel))
    .filter((padrao): padrao is Padrao => padrao !== null);
}

/** O padrao que exclui o caminho, ou `null` se ele sobrevive. */
function quemExclui(caminho: string, padroes: readonly Padrao[]): Padrao | null {
  let excluido: Padrao | null = null;

  // O ultimo padrao que casa decide, nas duas semanticas.
  for (const padrao of padroes) {
    if (padrao.regex.test(caminho)) {
      excluido = padrao.negado ? null : padrao;
    }
  }

  return excluido;
}

describe('arquivos de codigo nunca saem do repositorio nem do build context', () => {
  const codigo = arquivosDeCodigo('src');

  it('ha arquivos para verificar', () => {
    // Protege o proprio teste: um erro de caminho o tornaria vacuamente verde.
    expect(codigo.length).toBeGreaterThan(100);
    expect(codigo).toContain(`${DIRETORIO_SENSIVEL}/storage.port.ts`);
    expect(codigo).toContain(`${DIRETORIO_SENSIVEL}/storage-adapters.spec.ts`);
    expect(codigo).toContain(`${DIRETORIO_SENSIVEL}/storage-key.spec.ts`);
  });

  describe('.gitignore da raiz', () => {
    // O gitignore vale para o repositorio inteiro, e os caminhos sao relativos
    // a raiz - daí o prefixo `backend/`.
    const padroes = carregarPadroes(join(REPO, '.gitignore'), true);

    it('nao exclui nenhum arquivo de codigo do backend', () => {
      const excluidos = codigo
        .map((caminho) => ({ caminho, padrao: quemExclui(`backend/${caminho}`, padroes) }))
        .filter((item) => item.padrao !== null)
        .map((item) => `${item.caminho} <- "${item.padrao?.original}"`);

      expect(excluidos).toEqual([]);
    });

    it(`nao exclui nada em ${DIRETORIO_SENSIVEL} (o incidente real)`, () => {
      // Teste proprio porque foi exatamente aqui que dois arquivos se perderam.
      const sensiveis = codigo.filter((caminho) => caminho.startsWith(DIRETORIO_SENSIVEL));

      expect(sensiveis.length).toBeGreaterThanOrEqual(6);
      for (const caminho of sensiveis) {
        expect(quemExclui(`backend/${caminho}`, padroes)).toBeNull();
      }
    });

    it('continua ignorando o storage de documentos em tempo de execucao', () => {
      // A correcao nao pode ter ido longe demais: os bytes enviados em
      // desenvolvimento seguem fora do repositorio.
      expect(quemExclui('backend/storage/documents/2026/10/07/arquivo.bin', padroes)).not.toBeNull();
      expect(quemExclui('storage/documents/arquivo.bin', padroes)).not.toBeNull();
    });
  });

  describe('backend/.dockerignore', () => {
    const padroes = carregarPadroes(join(BACKEND, '.dockerignore'), false);

    it('nao exclui nenhum arquivo de codigo do backend', () => {
      const excluidos = codigo
        .map((caminho) => ({ caminho, padrao: quemExclui(caminho, padroes) }))
        .filter((item) => item.padrao !== null)
        .map((item) => `${item.caminho} <- "${item.padrao?.original}"`);

      expect(excluidos).toEqual([]);
    });

    it(`nao exclui nada em ${DIRETORIO_SENSIVEL}`, () => {
      for (const caminho of codigo.filter((c) => c.startsWith(DIRETORIO_SENSIVEL))) {
        expect(quemExclui(caminho, padroes)).toBeNull();
      }
    });

    it('continua excluindo o que nao deve entrar na imagem', () => {
      // O ignore precisa funcionar: segredo, dependencia e artefato ficam fora.
      for (const caminho of [
        'node_modules/alguma-lib/index.js',
        'dist/main.js',
        '.env',
        '.env.producao',
        'coverage/lcov.info',
        'storage/documents/arquivo.bin',
      ]) {
        expect(quemExclui(caminho, padroes)).not.toBeNull();
      }
    });

    it('NAO exclui o .env.example, que e documentacao', () => {
      expect(quemExclui('.env.example', padroes)).toBeNull();
    });
  });

  it('o matcher de padroes esta correto nos casos que importam', () => {
    // Sem isto, um matcher quebrado deixaria os testes acima vacuamente verdes.
    const gitignore = (p: string): Padrao => compilar(p, true) as Padrao;
    const dockerignore = (p: string): Padrao => compilar(p, false) as Padrao;

    // O bug real: sem ancora, o gitignore casa em qualquer nivel.
    expect(gitignore('storage/').regex.test('backend/src/modules/documents/storage/x.ts')).toBe(
      true,
    );
    // Com ancora, nao casa.
    expect(gitignore('/storage/').regex.test('backend/src/modules/documents/storage/x.ts')).toBe(
      false,
    );
    // No Docker a semantica e outra: sem `**`, so casa na raiz do contexto.
    expect(dockerignore('storage').regex.test('src/modules/documents/storage/x.ts')).toBe(false);
    // E com `**` volta a ser perigoso.
    expect(dockerignore('**/storage').regex.test('src/modules/documents/storage/x.ts')).toBe(true);
    // Negacao reverte.
    expect(quemExclui('.env.example', [gitignore('.env.*'), gitignore('!.env.example')])).toBeNull();
  });
});
