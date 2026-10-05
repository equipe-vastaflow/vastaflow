import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './app.setup';

interface ChamadasRegistradas {
  set: [string, unknown][];
  bodyParser: [string, Record<string, unknown>][];
  pipes: number;
  filters: number;
}

/** Aplicacao de mentira que registra o que o `configureApp` configurou nela. */
function appFalsa(): { app: NestExpressApplication; chamadas: ChamadasRegistradas } {
  const chamadas: ChamadasRegistradas = { set: [], bodyParser: [], pipes: 0, filters: 0 };
  const app = {
    set: (chave: string, valor: unknown): void => {
      chamadas.set.push([chave, valor]);
    },
    useBodyParser: (tipo: string, opcoes: Record<string, unknown>): void => {
      chamadas.bodyParser.push([tipo, opcoes]);
    },
    useGlobalPipes: (): void => {
      chamadas.pipes += 1;
    },
    useGlobalFilters: (): void => {
      chamadas.filters += 1;
    },
  } as unknown as NestExpressApplication;

  return { app, chamadas };
}

describe('configureApp', () => {
  describe('trust proxy', () => {
    it('configura um unico salto confiavel', () => {
      const { app, chamadas } = appFalsa();

      configureApp(app);

      expect(chamadas.set).toEqual([['trust proxy', 1]]);
    });

    it('NUNCA usa `true`, que confiaria na cadeia inteira de X-Forwarded-For', () => {
      // Com `true` qualquer cliente poderia inventar o proprio IP escrevendo o
      // header - num campo que vai para a trilha de auditoria.
      const { app, chamadas } = appFalsa();

      configureApp(app);

      const [, valor] = chamadas.set[0];
      expect(valor).not.toBe(true);
      expect(typeof valor).toBe('number');
    });
  });

  describe('limite de corpo', () => {
    it('define o limite EXPLICITAMENTE, sem depender do padrao do framework', () => {
      // O padrao do Express hoje coincide com o valor escolhido, entao nenhum
      // teste de comportamento distinguiria os dois casos. Este distingue: e o
      // que protege de uma mudanca de padrao do framework.
      const { app, chamadas } = appFalsa();

      configureApp(app);

      expect(chamadas.bodyParser.map(([tipo]) => tipo).sort()).toEqual(['json', 'urlencoded']);
      for (const [, opcoes] of chamadas.bodyParser) {
        expect(opcoes.limit).toBe('100kb');
      }
    });

    it('o limite e o mesmo para json e urlencoded', () => {
      const { app, chamadas } = appFalsa();

      configureApp(app);

      const limites = new Set(chamadas.bodyParser.map(([, opcoes]) => opcoes.limit));
      expect(limites.size).toBe(1);
    });

    it('nao e um limite de upload: continua na ordem de dezenas de kB', () => {
      // Blinda a decisao de nao inflar o limite global para acomodar arquivo.
      // Upload tera regra propria quando a fundacao de documentos existir.
      const { app, chamadas } = appFalsa();

      configureApp(app);

      expect(String(chamadas.bodyParser[0][1].limit)).toMatch(/^\d{2,3}kb$/);
    });
  });

  it('mantem o pipe de validacao e o filtro global de erros', () => {
    const { app, chamadas } = appFalsa();

    configureApp(app);

    expect(chamadas.pipes).toBe(1);
    expect(chamadas.filters).toBe(1);
  });
});
