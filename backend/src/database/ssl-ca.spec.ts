import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AMBIGUOUS_CA_MESSAGE,
  emptyCaMessage,
  MISSING_CA_MESSAGE,
  resolveSslCa,
  unreadableCaMessage,
} from './ssl-ca';

/** Texto com a forma de um PEM. NAO e um certificado: nada aqui e material real. */
const PEM = '-----BEGIN CERTIFICATE-----\nconteudo-de-teste\n-----END CERTIFICATE-----';

describe('resolveSslCa', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vastaflow-ca-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Cria um arquivo no diretorio temporario e devolve o caminho. */
  const arquivo = (nome: string, conteudo: string): string => {
    const caminho = join(dir, nome);
    writeFileSync(caminho, conteudo, 'utf8');
    return caminho;
  };

  describe('conteudo inline', () => {
    it('devolve o PEM informado', () => {
      expect(resolveSslCa({ inline: PEM })).toBe(PEM);
    });

    it('remove espacos das pontas', () => {
      expect(resolveSslCa({ inline: `  ${PEM}  ` })).toBe(PEM);
    });
  });

  describe('arquivo montado', () => {
    it('le o conteudo do arquivo', () => {
      expect(resolveSslCa({ file: arquivo('ca.pem', PEM) })).toBe(PEM);
    });

    it('remove espacos e quebra de linha final', () => {
      expect(resolveSslCa({ file: arquivo('ca.pem', `${PEM}\n\n`) })).toBe(PEM);
    });

    it('arquivo inexistente e RECUSADO, nomeando o caminho', () => {
      const inexistente = join(dir, 'nao-existe.pem');

      expect(() => resolveSslCa({ file: inexistente })).toThrow(unreadableCaMessage(inexistente));
    });

    it('diretorio no lugar de arquivo e RECUSADO', () => {
      // Existe, mas nao da para ler como arquivo. Sem o tratamento, o erro do
      // Node (EISDIR) subiria cru.
      expect(() => resolveSslCa({ file: dir })).toThrow(unreadableCaMessage(dir));
    });

    it.each(['', '   ', '\n\n'])('arquivo vazio (%j) e RECUSADO', (conteudo) => {
      const caminho = arquivo('vazio.pem', conteudo);

      expect(() => resolveSslCa({ file: caminho })).toThrow(emptyCaMessage(caminho));
    });

    it('a mensagem de falha NAO contem o conteudo do arquivo', () => {
      // O certificado nao e segredo, mas imprimi-lo em log nao ajuda ninguem.
      const caminho = arquivo('ca.pem', 'CONTEUDO-QUE-NAO-DEVE-APARECER');
      // Forca uma falha de leitura removendo o arquivo depois de criar.
      rmSync(caminho);

      try {
        resolveSslCa({ file: caminho });
        throw new Error('deveria ter sido recusado');
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);

        expect(mensagem).toContain('DATABASE_SSL_CA_FILE');
        expect(mensagem).not.toContain('CONTEUDO-QUE-NAO-DEVE-APARECER');
      }
    });
  });

  describe('exatamente uma das duas', () => {
    it('nenhuma informada e RECUSADO', () => {
      expect(() => resolveSslCa({})).toThrow(MISSING_CA_MESSAGE);
    });

    it.each([
      ['', ''],
      ['   ', '   '],
      [undefined, ''],
      ['', undefined],
    ])('em branco conta como ausente: inline=%j file=%j', (inline, file) => {
      expect(() => resolveSslCa({ inline, file })).toThrow(MISSING_CA_MESSAGE);
    });

    it('as DUAS informadas e RECUSADO - nao existe precedencia', () => {
      // Deliberadamente sem precedencia: com ela, quem configurasse as duas por
      // engano nao saberia qual esta em uso, e descobriria por comportamento
      // estranho em producao.
      expect(() => resolveSslCa({ inline: PEM, file: arquivo('ca.pem', PEM) })).toThrow(
        AMBIGUOUS_CA_MESSAGE,
      );
    });

    it('a recusa por ambiguidade acontece ANTES de tentar ler o arquivo', () => {
      // Com as duas informadas, nem importa se o arquivo existe: a configuracao
      // ja esta ambigua.
      expect(() => resolveSslCa({ inline: PEM, file: join(dir, 'nao-existe.pem') })).toThrow(
        AMBIGUOUS_CA_MESSAGE,
      );
    });

    it('inline em branco + arquivo valido usa o arquivo', () => {
      expect(resolveSslCa({ inline: '  ', file: arquivo('ca.pem', PEM) })).toBe(PEM);
    });

    it('arquivo em branco + inline valido usa o inline', () => {
      expect(resolveSslCa({ inline: PEM, file: '   ' })).toBe(PEM);
    });
  });

  describe('mensagens', () => {
    it('nomeiam as duas variaveis e nao expoem valor', () => {
      expect(MISSING_CA_MESSAGE).toContain('DATABASE_SSL_CA');
      expect(MISSING_CA_MESSAGE).toContain('DATABASE_SSL_CA_FILE');
      expect(AMBIGUOUS_CA_MESSAGE).toContain('DATABASE_SSL_CA');
      expect(AMBIGUOUS_CA_MESSAGE).toContain('DATABASE_SSL_CA_FILE');

      for (const mensagem of [MISSING_CA_MESSAGE, AMBIGUOUS_CA_MESSAGE]) {
        expect(mensagem).not.toMatch(/-----BEGIN|senha|password|secret/i);
      }
    });
  });
});
