import { decodeMultipartFilename } from './multipart-filename';

/** O que o `busboy` entrega quando o navegador manda UTF-8. */
const comoChega = (nome: string): string => Buffer.from(nome, 'utf8').toString('latin1');

describe('decodeMultipartFilename', () => {
  it.each([
    'Declaração de Imposto de Renda.pdf',
    'Contrato João Pedro.pdf',
    'relatório — anexo (1).pdf',
    'ação, ñ, çedilha.xlsx',
    '中文文件.pdf',
    'emoji 📄.pdf',
  ])('restaura %j', (original) => {
    expect(decodeMultipartFilename(comoChega(original))).toBe(original);
  });

  it('nome so com ASCII fica intacto', () => {
    for (const nome of ['contrato.pdf', 'relatorio-2026.xlsx', 'a_b-c.1.csv']) {
      expect(decodeMultipartFilename(nome)).toBe(nome);
    }
  });

  it('nome vazio nao quebra', () => {
    expect(decodeMultipartFilename('')).toBe('');
  });

  it('nao e idempotente por acidente: aplicar duas vezes NAO destroi o nome', () => {
    // Depois de corrigido, o nome ja e UTF-8 valido; reinterpretar de novo
    // produziria lixo, e a guarda de validade impede isso.
    const corrigido = decodeMultipartFilename(comoChega('Declaração.pdf'));

    expect(decodeMultipartFilename(corrigido)).toBe('Declaração.pdf');
  });

  it('bytes que NAO formam UTF-8 valido preservam o nome original', () => {
    // Esta e a guarda que importa: sem ela, um nome realmente latin1 (vindo de
    // um cliente antigo) viraria caracteres de substituicao - destruido em vez
    // de apenas estranho.
    for (const nome of ['arquivo-ÿþ.pdf', 'nãõ.pdf', 'ÀÁÂ.pdf']) {
      const resultado = decodeMultipartFilename(nome);

      expect(resultado).not.toContain('�');
      expect(resultado === nome || Buffer.from(nome, 'latin1').toString('utf8') === resultado).toBe(
        true,
      );
    }
  });

  it('nunca devolve caractere de substituicao', () => {
    // Varre toda a faixa latin1 isolada: nenhuma entrada produz nome destruido.
    for (let codigo = 0x80; codigo <= 0xff; codigo += 1) {
      const nome = `arquivo${String.fromCharCode(codigo)}.pdf`;

      expect(decodeMultipartFilename(nome)).not.toContain('�');
    }
  });

  it('valor nao textual e devolvido como veio', () => {
    const indefinido = undefined as unknown as string;

    expect(decodeMultipartFilename(indefinido)).toBe(indefinido);
  });
});
