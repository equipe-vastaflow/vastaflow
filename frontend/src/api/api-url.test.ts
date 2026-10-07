import { describe, expect, it } from 'vitest';
import { DEV_API_URL, MISSING_API_URL_MESSAGE, resolveApiUrl } from './api-url';

describe('resolveApiUrl', () => {
  describe('producao', () => {
    it('sem VITE_API_URL: RECUSADO', () => {
      // O ponto da mudanca: antes isto devolvia http://localhost:3000 em
      // silencio e o bundle de producao saia apontando para a maquina de quem
      // abrisse o navegador.
      expect(() => resolveApiUrl({ PROD: true })).toThrow(MISSING_API_URL_MESSAGE);
    });

    it.each(['', '   ', '\n\t '])('VITE_API_URL em branco (%j): RECUSADO', (valor) => {
      // String so com espacos e truthy: sem o `trim` ela passaria como URL.
      expect(() => resolveApiUrl({ PROD: true, VITE_API_URL: valor })).toThrow(
        MISSING_API_URL_MESSAGE,
      );
    });

    it('com VITE_API_URL: usa exatamente o valor informado', () => {
      expect(resolveApiUrl({ PROD: true, VITE_API_URL: 'https://api.exemplo.test' })).toBe(
        'https://api.exemplo.test',
      );
    });

    it('nunca cai no fallback de desenvolvimento', () => {
      // Blinda a regra inteira: nao existe combinacao de entradas em producao
      // que devolva o fallback. Ou devolve o valor informado, ou lanca.
      for (const valor of [undefined, '', '   ']) {
        const resultado = ((): string => {
          try {
            return resolveApiUrl({ PROD: true, VITE_API_URL: valor });
          } catch {
            return 'lancou';
          }
        })();

        expect(resultado).toBe('lancou');
      }
    });

    it('a mensagem nomeia a variavel e nao expoe valor algum', () => {
      expect(MISSING_API_URL_MESSAGE).toContain('VITE_API_URL');
      expect(MISSING_API_URL_MESSAGE).not.toMatch(/token|senha|secret|password/i);
    });
  });

  describe('desenvolvimento', () => {
    it('sem VITE_API_URL: usa o fallback local, sem lancar', () => {
      // Conveniencia de desenvolvimento preservada: `npm run dev` continua
      // funcionando sem configurar nada.
      expect(resolveApiUrl({})).toBe(DEV_API_URL);
      expect(resolveApiUrl({ PROD: false })).toBe(DEV_API_URL);
    });

    it('com VITE_API_URL: o valor informado tem precedencia', () => {
      expect(resolveApiUrl({ PROD: false, VITE_API_URL: 'http://127.0.0.1:4000' })).toBe(
        'http://127.0.0.1:4000',
      );
    });

    it('VITE_API_URL em branco cai no fallback em vez de virar URL vazia', () => {
      expect(resolveApiUrl({ PROD: false, VITE_API_URL: '   ' })).toBe(DEV_API_URL);
    });
  });

  describe('normalizacao', () => {
    it.each([
      ['https://api.exemplo.test/', 'https://api.exemplo.test'],
      ['https://api.exemplo.test///', 'https://api.exemplo.test'],
      ['  https://api.exemplo.test  ', 'https://api.exemplo.test'],
      ['https://api.exemplo.test/base/', 'https://api.exemplo.test/base'],
    ])('remove barra final e espacos: %j -> %j', (entrada, esperado) => {
      // Cada chamada monta `${API_URL}/caminho`; barra dupla quebraria a rota.
      expect(resolveApiUrl({ PROD: true, VITE_API_URL: entrada })).toBe(esperado);
    });

    it('nao inventa esquema nem acrescenta nada ao valor', () => {
      // Se alguem informar um valor estranho, ele passa como foi informado: a
      // funcao impede o fallback silencioso, nao adivinha a intencao.
      expect(resolveApiUrl({ PROD: true, VITE_API_URL: 'api.exemplo.test' })).toBe(
        'api.exemplo.test',
      );
    });
  });

  it('PROD so bloqueia com `true` exato, nao com valor truthy qualquer', () => {
    // `import.meta.env.PROD` e booleano. Aceitar truthy generico faria uma
    // string vazia ou um 0 mudarem o comportamento de forma surpreendente.
    const env = { PROD: undefined, VITE_API_URL: undefined };

    expect(resolveApiUrl(env)).toBe(DEV_API_URL);
  });
});
