import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Propriedades que nao aparecem no COMPORTAMENTO e por isso precisam ser
 * conferidas na estrutura do codigo.
 *
 * Uma comparacao `===` entre hashes devolve exatamente o mesmo resultado que
 * `timingSafeEqual`; nenhum teste funcional distingue as duas. A diferenca e
 * so o tempo de resposta, e e por isso que esta garantia mora aqui.
 */
const DIR = __dirname;

function fontes(): Array<{ nome: string; texto: string }> {
  return readdirSync(DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((nome) => ({ nome, texto: readFileSync(join(DIR, nome), 'utf8') }));
}

/** Remove comentarios, para que uma explicacao em texto nao dispare as buscas. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('autenticacao de servico: propriedades estruturais', () => {
  it('ha fontes para examinar (o teste nao passa por vazio)', () => {
    expect(fontes().length).toBeGreaterThanOrEqual(8);
  });

  it('o store compara os hashes com timingSafeEqual', () => {
    const store = fontes().find((f) => f.nome === 'service-credentials.store.ts');

    expect(store).toBeDefined();
    expect(semComentarios(store?.texto ?? '')).toMatch(/timingSafeEqual\(/);
  });

  it('nenhum fonte compara hash ou token com === / !== / indexOf / includes', () => {
    const suspeitos = [
      /\b(?:sha256|digest|hash|token)\w*\s*[!=]==?\s*\w/i,
      /\b\w+\s*[!=]==?\s*\w*(?:sha256|digest|hash)\b/i,
    ];

    const achados = fontes()
      .filter((f) => f.nome !== 'service-token.ts')
      .flatMap((f) =>
        semComentarios(f.texto)
          .split('\n')
          .filter((linha) => suspeitos.some((re) => re.test(linha)))
          .map((linha) => `${f.nome}: ${linha.trim()}`),
      );

    expect(achados).toEqual([]);
  });

  it('nenhum fonte usa console.* (log so pelo Logger do Nest, que nao recebe o token)', () => {
    const achados = fontes()
      .filter((f) => semComentarios(f.texto).includes('console.'))
      .map((f) => f.nome);

    expect(achados).toEqual([]);
  });

  it('nenhum fonte grava o token em arquivo (so o hash)', () => {
    const cli = fontes().find((f) => f.nome === 'service-credential.cli.ts');
    const escritas = semComentarios(cli?.texto ?? '')
      .split('\n')
      .filter((l) => l.includes('writeFileSync('));

    // Uma unica escrita, e ela grava o arquivo serializado de HASHES.
    expect(escritas).toHaveLength(1);
    expect(escritas[0]).toContain('serializeCredentialsFile(file)');
  });
});
