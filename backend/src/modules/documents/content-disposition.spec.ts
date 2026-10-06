import { contentDispositionFor } from './content-disposition';

/** Nomes que tentam injetar cabecalho ou quebrar o valor. */
const NOMES_HOSTIS = [
  'arquivo\r\nX-Injected: sim.pdf',
  'arquivo\nX-Injected: sim.pdf',
  'arquivo\rX-Injected: sim.pdf',
  'arquivo\r\n\r\n<html>ataque</html>.pdf',
  '"arquivo".pdf',
  'arquivo;teste.pdf',
  'arquivo"; X-Injected="sim.pdf',
  'arquivo\\escapado.pdf',
  "arquivo'aspas.pdf",
  'arquivo\u0000nulo.pdf',
  'arquivo\u0007bell.pdf',
  'arquivo\u001bescape.pdf',
];

describe('contentDispositionFor', () => {
  it('sempre attachment, nunca inline', () => {
    // E o que impede o navegador de renderizar o conteudo na origem da
    // aplicacao.
    expect(contentDispositionFor('contrato.pdf').startsWith('attachment;')).toBe(true);
    expect(contentDispositionFor('pagina.xml')).not.toContain('inline');
  });

  it('nome simples aparece nas duas formas', () => {
    const header = contentDispositionFor('contrato.pdf');

    expect(header).toBe('attachment; filename="contrato.pdf"; filename*=UTF-8\'\'contrato.pdf');
  });

  it('preserva acento no filename*, que e o que o navegador usa', () => {
    const header = contentDispositionFor('Contrato João.pdf');

    expect(header).toContain("filename*=UTF-8''Contrato%20Jo%C3%A3o.pdf");
    // O fallback ASCII perde o acento, de proposito: ele existe para clientes
    // antigos, que nao entendem `filename*`.
    expect(header).toContain('filename="Contrato Joo.pdf"');
  });

  it.each(NOMES_HOSTIS)('nao permite injecao de cabecalho com %j', (nome) => {
    const header = contentDispositionFor(nome);

    // A propriedade que importa: nenhuma quebra de linha e nenhum caractere de
    // controle sobrevive. Com CR ou LF no valor, o cliente passaria a ver um
    // cabecalho novo - e e SO isso que caracteriza injecao.
    //
    // O texto `X-Injected` continuar aparecendo DENTRO das aspas do nome nao e
    // injecao: e so parte do nome do arquivo. Uma assercao contra o texto
    // mediria a coisa errada.
    expect(header).not.toMatch(/[\r\n]/);
    // Sem regex de caractere de controle: o lint a recusa, e percorrer os
    // codigos diz a mesma coisa de forma mais explicita.
    const controle = [...header].filter((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      return codigo < 0x20 || codigo === 0x7f;
    });
    expect(controle).toEqual([]);

    // O cabecalho tem exatamente a forma esperada, com um unico `filename=` e
    // um unico `filename*=`.
    expect(header).toMatch(/^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''[^\r\n]*$/);
    expect((header.match(/filename=/g) ?? []).length).toBe(1);
    expect((header.match(/filename\*=/g) ?? []).length).toBe(1);
  });

  it('nao deixa aspas nem ponto-e-virgula quebrarem o valor', () => {
    const header = contentDispositionFor('arquivo"; X-Injected="sim.pdf');
    const parteAscii = header.slice(header.indexOf('filename="'), header.indexOf('; filename*='));

    // Dentro das aspas sobra apenas uma aspa de abertura e uma de fechamento.
    expect((parteAscii.match(/"/g) ?? []).length).toBe(2);
    expect(parteAscii).not.toContain(';');
  });

  it('nome sem base ASCII mantem a extensao e completa o nome', () => {
    // Filtrar `中文文件.pdf` deixaria so `.pdf` - arquivo oculto sem nome em
    // sistema Unix. O nome real continua no `filename*`.
    const header = contentDispositionFor('中文文件.pdf');

    expect(header).toContain('filename="documento.pdf"');
    expect(header).toContain("filename*=UTF-8''%E4%B8%AD%E6%96%87");
  });

  it('nome totalmente sem ASCII legivel recebe o nome generico', () => {
    expect(contentDispositionFor('中文文件')).toContain('filename="documento"');
  });

  it('nome parcialmente ASCII mantem a parte legivel', () => {
    const header = contentDispositionFor('Contrato 中文 2026.pdf');

    expect(header).toContain('filename="Contrato  2026.pdf"');
  });

  it('nome vazio nao produz valor vazio', () => {
    expect(contentDispositionFor('')).toContain('filename="documento"');
  });

  it('escapa os caracteres que fechariam o filename* cedo', () => {
    const header = contentDispositionFor("arquivo'com*asterisco().pdf");

    expect(header).toContain('%27');
    expect(header).toContain('%2A');
    expect(header).toContain('%28');
    expect(header).toContain('%29');
  });

  it('o cabecalho inteiro fica em uma unica linha', () => {
    for (const nome of NOMES_HOSTIS) {
      expect(contentDispositionFor(nome).split('\n')).toHaveLength(1);
    }
  });
});
