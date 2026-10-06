import {
  ALLOWED_EXTENSIONS,
  checkUploadedFile,
  extensionOf,
  NAME_MAX_BYTES,
  type UploadedFileLike,
} from './document-file.policy';

const MAX = 10 * 1024 * 1024;

function arquivo(overrides: Partial<UploadedFileLike> = {}): UploadedFileLike {
  return {
    originalname: 'contrato.pdf',
    mimetype: 'application/pdf',
    size: 4,
    buffer: Buffer.from('%PDF'),
    ...overrides,
  };
}

describe('checkUploadedFile', () => {
  describe('arquivo presente', () => {
    it('aceita um PDF valido', () => {
      expect(checkUploadedFile(arquivo(), MAX)).toEqual({ ok: true });
    });

    it('recusa arquivo ausente', () => {
      expect(checkUploadedFile(undefined, MAX)).toEqual({
        ok: false,
        erro: 'Envie um arquivo no campo "arquivo"',
      });
    });

    it('recusa quando o conteudo nao e um Buffer', () => {
      // Acontece se o interceptor for configurado para gravar em disco: o
      // campo `buffer` nao existe. Falhar alto e melhor que gravar vazio.
      const semBuffer = { ...arquivo(), buffer: undefined } as unknown as UploadedFileLike;

      expect(checkUploadedFile(semBuffer, MAX).ok).toBe(false);
    });

    it('recusa arquivo vazio', () => {
      expect(checkUploadedFile(arquivo({ buffer: Buffer.alloc(0) }), MAX)).toEqual({
        ok: false,
        erro: 'Arquivo vazio',
      });
    });
  });

  describe('tamanho', () => {
    it('aceita exatamente o limite', () => {
      const conteudo = Buffer.alloc(100, 0x25);

      expect(checkUploadedFile(arquivo({ buffer: conteudo }), 100).ok).toBe(true);
    });

    it('recusa um byte acima do limite', () => {
      const conteudo = Buffer.alloc(101, 0x25);

      expect(checkUploadedFile(arquivo({ buffer: conteudo }), 100).ok).toBe(false);
    });

    it('usa o tamanho do BUFFER, nao o campo `size` informado', () => {
      // `size` vem do interceptor e nao e o que foi gravado. Confiar nele
      // deixaria passar arquivo maior que o limite.
      const mentiroso = arquivo({ buffer: Buffer.alloc(500), size: 1 });

      expect(checkUploadedFile(mentiroso, 100).ok).toBe(false);
    });
  });

  describe('nome', () => {
    it('recusa nome vazio ou so espacos', () => {
      expect(checkUploadedFile(arquivo({ originalname: '' }), MAX).ok).toBe(false);
      expect(checkUploadedFile(arquivo({ originalname: '   ' }), MAX).ok).toBe(false);
    });

    it('aceita nome com acento, espaco e Unicode', () => {
      for (const nome of [
        'Contrato João Pedro.pdf',
        'Declaração de Imposto de Renda.pdf',
        'relatório — anexo (1).pdf',
        '中文文件.pdf',
        'emoji 📄.pdf',
      ]) {
        expect(checkUploadedFile(arquivo({ originalname: nome }), MAX).ok).toBe(true);
      }
    });

    it('limita o nome por BYTES, nao por caracteres', () => {
      // A coluna e `varchar2(255)` no Oracle, onde o tamanho e contado em
      // bytes. 200 caracteres acentuados passam de 255 bytes.
      const acentuado = 'ç'.repeat(200);
      expect(Buffer.byteLength(acentuado, 'utf8')).toBeGreaterThan(NAME_MAX_BYTES);

      expect(checkUploadedFile(arquivo({ originalname: `${acentuado}.pdf` }), MAX).ok).toBe(false);
    });

    it('aceita nome longo que ainda cabe em bytes', () => {
      const nome = `${'a'.repeat(NAME_MAX_BYTES - 4)}.pdf`;

      expect(checkUploadedFile(arquivo({ originalname: nome }), MAX).ok).toBe(true);
    });

    it('recusa byte nulo no nome', () => {
      // `arquivo%00.exe` decodificado: truque classico para enganar
      // verificacao de extensao.
      expect(checkUploadedFile(arquivo({ originalname: 'arquivo\0.exe' }), MAX).ok).toBe(false);
      expect(checkUploadedFile(arquivo({ originalname: 'contrato.pdf\0.exe' }), MAX).ok).toBe(
        false,
      );
    });
  });

  describe('extensao', () => {
    it.each(ALLOWED_EXTENSIONS)('aceita %s com um MIME compativel', (extensao) => {
      const mimePorExtensao: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.csv': 'text/csv',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xml': 'application/xml',
      };

      const resultado = checkUploadedFile(
        arquivo({ originalname: `doc${extensao}`, mimetype: mimePorExtensao[extensao] }),
        MAX,
      );

      expect(resultado).toEqual({ ok: true });
    });

    it.each(['.exe', '.bat', '.cmd', '.sh', '.ps1', '.php', '.js', '.html', '.htm', '.svg'])(
      'recusa a extensao executavel/interpretavel %s',
      (extensao) => {
        const resultado = checkUploadedFile(
          arquivo({ originalname: `malicioso${extensao}`, mimetype: 'application/octet-stream' }),
          MAX,
        );

        expect(resultado.ok).toBe(false);
      },
    );

    it('recusa arquivo sem extensao', () => {
      expect(checkUploadedFile(arquivo({ originalname: 'semextensao' }), MAX).ok).toBe(false);
    });

    it('extensao dupla: vale a ULTIMA', () => {
      // `contrato.pdf.exe` e um `.exe` e e recusado.
      expect(checkUploadedFile(arquivo({ originalname: 'contrato.pdf.exe' }), MAX).ok).toBe(false);

      // `malicioso.exe.pdf` e um `.pdf` e passa - e passar esta correto: a
      // chave fisica nao leva a extensao original, o download sai como anexo e
      // nada no servidor executa o arquivo.
      expect(checkUploadedFile(arquivo({ originalname: 'malicioso.exe.pdf' }), MAX).ok).toBe(true);
    });

    it('a extensao e normalizada para minusculas', () => {
      for (const nome of ['CONTRATO.PDF', 'Contrato.Pdf', 'contrato.pDf']) {
        expect(checkUploadedFile(arquivo({ originalname: nome }), MAX).ok).toBe(true);
      }
    });

    it('a mensagem de recusa lista as extensoes aceitas', () => {
      const resultado = checkUploadedFile(arquivo({ originalname: 'x.exe' }), MAX);

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.erro).toContain('.pdf');
      }
    });
  });

  describe('MIME', () => {
    it('recusa MIME incoerente com a extensao', () => {
      // `.pdf` com `text/html` e o caso classico de tentativa de servir HTML.
      expect(
        checkUploadedFile(arquivo({ originalname: 'x.pdf', mimetype: 'text/html' }), MAX).ok,
      ).toBe(false);
      expect(
        checkUploadedFile(arquivo({ originalname: 'x.pdf', mimetype: 'image/svg+xml' }), MAX).ok,
      ).toBe(false);
    });

    it('NAO aceita application/octet-stream como curinga', () => {
      // Aceita-lo equivaleria a desligar a conferencia: qualquer arquivo pode
      // ser enviado com esse tipo.
      for (const extensao of ALLOWED_EXTENSIONS) {
        const resultado = checkUploadedFile(
          arquivo({ originalname: `doc${extensao}`, mimetype: 'application/octet-stream' }),
          MAX,
        );

        expect(resultado.ok).toBe(false);
      }
    });

    it('ignora parametros do MIME e a caixa', () => {
      for (const mime of [
        'application/pdf; charset=utf-8',
        'APPLICATION/PDF',
        ' application/pdf ',
      ]) {
        expect(checkUploadedFile(arquivo({ mimetype: mime }), MAX).ok).toBe(true);
      }
    });

    it('.csv aceita os MIME que diferentes sistemas enviam', () => {
      // O Windows manda `application/vnd.ms-excel` para `.csv`.
      for (const mime of [
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel',
        'text/plain',
      ]) {
        const resultado = checkUploadedFile(
          arquivo({ originalname: 'planilha.csv', mimetype: mime }),
          MAX,
        );

        expect(resultado.ok).toBe(true);
      }
    });

    it('recusa MIME ausente', () => {
      const semMime = { ...arquivo(), mimetype: undefined } as unknown as UploadedFileLike;

      expect(checkUploadedFile(semMime, MAX).ok).toBe(false);
    });
  });

  it('imagens NAO estao na lista: nao ha caso de uso no projeto', () => {
    for (const nome of ['foto.png', 'foto.jpg', 'foto.jpeg', 'foto.gif', 'foto.webp']) {
      expect(
        checkUploadedFile(arquivo({ originalname: nome, mimetype: 'image/png' }), MAX).ok,
      ).toBe(false);
    }
  });
});

describe('extensionOf', () => {
  it.each([
    ['contrato.pdf', '.pdf'],
    ['CONTRATO.PDF', '.pdf'],
    ['arquivo.tar.gz', '.gz'],
    ['contrato.pdf.exe', '.exe'],
    ['nome com espaco.docx', '.docx'],
    ['.oculto.pdf', '.pdf'],
  ])('%s -> %s', (nome, esperado) => {
    expect(extensionOf(nome)).toBe(esperado);
  });

  it.each(['semextensao', '.oculto', 'termina-com-ponto.', ''])('%j nao tem extensao', (nome) => {
    expect(extensionOf(nome)).toBeNull();
  });
});
