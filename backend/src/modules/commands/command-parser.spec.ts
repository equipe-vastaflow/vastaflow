import { parseCommand, type ParsedCommand } from './command-parser';

/** Extrai o comando reconhecido, falhando o teste se o texto nao for um. */
function command(text: string): ParsedCommand {
  const result = parseCommand(text);
  if (result.kind !== 'command') {
    throw new Error(`esperava um comando, veio '${result.kind}'`);
  }
  return result.command;
}

describe('parseCommand', () => {
  describe('comandos do motor', () => {
    it('reconhece /ajuda', () => {
      expect(command('/ajuda')).toEqual({ name: 'ajuda', args: [] });
    });

    it('reconhece /status', () => {
      expect(command('/status')).toEqual({ name: 'status', args: [] });
    });
  });

  describe('argumentos', () => {
    it('separa os argumentos depois do nome', () => {
      expect(command('/comando arg1 arg2')).toEqual({
        name: 'comando',
        args: ['arg1', 'arg2'],
      });
    });

    it('ignora espacos repetidos entre os argumentos', () => {
      expect(command('/comando   arg1    arg2')).toEqual({
        name: 'comando',
        args: ['arg1', 'arg2'],
      });
    });

    it('ignora espacos nas pontas da mensagem', () => {
      expect(command('   /ajuda   ')).toEqual({ name: 'ajuda', args: [] });
    });

    it('nao produz argumento vazio quando a mensagem termina em espaco', () => {
      expect(command('/comando arg1  ').args).toEqual(['arg1']);
    });

    it('preserva maiusculas e acentos nos argumentos', () => {
      expect(command('/comando Maria Silva').args).toEqual(['Maria', 'Silva']);
      expect(command('/comando Joao').args).toEqual(['Joao']);
    });

    it('nao interpreta os argumentos - nao ha regra de negocio no parser', () => {
      expect(command('/comando --flag=1 {"a":2}').args).toEqual(['--flag=1', '{"a":2}']);
    });
  });

  describe('normalizacao do nome', () => {
    it('trata o nome como minusculo', () => {
      expect(command('/AJUDA').name).toBe('ajuda');
      expect(command('/Ajuda').name).toBe('ajuda');
    });

    it('aceita digitos e underscore', () => {
      expect(command('/relatorio_2').name).toBe('relatorio_2');
    });
  });

  describe('mensagem vazia', () => {
    it.each(['', '   ', '\n\t '])('%j resulta em empty', (text) => {
      expect(parseCommand(text)).toEqual({ kind: 'empty' });
    });
  });

  describe('mensagem que nao e comando', () => {
    it.each(['bom dia', 'ajuda', 'preciso de /ajuda', '#ajuda', '!status'])(
      '%j resulta em not-a-command',
      (text) => {
        expect(parseCommand(text)).toEqual({ kind: 'not-a-command' });
      },
    );
  });

  describe('comando malformado', () => {
    it.each([
      ['/', 'barra sozinha'],
      ['/ ajuda', 'espaco depois da barra'],
      ['//ajuda', 'barra duplicada'],
      ['/aju-da', 'hifen no nome'],
      ['/ajuda!', 'pontuacao no nome'],
      ['/ajúda', 'acento no nome'],
    ])('%j (%s) resulta em malformed', (text) => {
      expect(parseCommand(text)).toEqual({ kind: 'malformed' });
    });
  });

  describe('comando desconhecido', () => {
    it('nome bem formado que nao existe ainda e um comando valido para o parser', () => {
      // Quem nao existe e o handler, e quem descobre isso e o router: o parser
      // nao conhece os comandos registrados.
      expect(command('/naoexiste')).toEqual({ name: 'naoexiste', args: [] });
    });
  });
});
