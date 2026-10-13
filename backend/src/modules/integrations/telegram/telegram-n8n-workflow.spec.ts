import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O workflow VERSIONADO do n8n (`integrations/telegram/n8n/`). O n8n so orquestra: este
 * teste trava as propriedades de seguranca do arquivo exportado, que nenhum teste de
 * comportamento do backend enxerga.
 */
interface N8nNode {
  readonly name: string;
  readonly type: string;
  readonly parameters: Record<string, unknown>;
  readonly credentials?: Record<string, { id: unknown; name: unknown }>;
  readonly webhookId?: unknown;
  readonly retryOnFail?: unknown;
}

interface Workflow {
  readonly name: string;
  readonly active: boolean;
  readonly nodes: readonly N8nNode[];
  readonly connections: Record<string, { main: Array<Array<{ node: string }>> }>;
  readonly settings: Record<string, unknown>;
  readonly pinData: Record<string, unknown>;
}

const CAMINHO = join(
  __dirname,
  '../../../../../integrations/telegram/n8n/vastaflow-telegram-ingest.workflow.json',
);
const TEXTO = readFileSync(CAMINHO, 'utf8');
const WORKFLOW = JSON.parse(TEXTO) as Workflow;

const porTipo = (tipo: string): N8nNode[] => WORKFLOW.nodes.filter((n) => n.type === tipo);
const INGEST_URL = 'http://backend:3000/service/telegram/ingest';

describe('workflow n8n do Telegram (versionado)', () => {
  it('e um JSON valido com nome, inativo e sem dado de execucao fixado', () => {
    expect(WORKFLOW.name).toBe('VastaFlow - Telegram (entrada)');
    expect(WORKFLOW.active).toBe(false);
    expect(WORKFLOW.pinData).toEqual({});
  });

  describe('sem segredo, sem ID sensivel, sem dado real', () => {
    it.each([
      ['token de servico', /vfs_[A-Za-z0-9_-]{10,}/],
      ['token de bot do Telegram', /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/],
      ['token do Plantae', /plt_/i],
      ['chave de assinatura', /SIGNING_KEY|INGEST_SIGNING/i],
      ['cabecalho Authorization/Bearer literal', /Bearer\s+\S+/],
      ['acesso a variavel de ambiente', /\$env|process\.env/],
      ['URL com credencial', /https?:\/\/[^/\s"]*:[^/\s"@]*@/],
    ])('nao contem %s', (_nome, padrao) => {
      expect(TEXTO).not.toMatch(padrao);
    });

    it('as referencias de credencial nao trazem ID (o operador escolhe a sua)', () => {
      const referencias = WORKFLOW.nodes.flatMap((n) => Object.values(n.credentials ?? {}));

      expect(referencias.length).toBeGreaterThan(0);
      for (const ref of referencias) {
        expect(ref.id).toBeNull();
      }
    });

    it('nao ha webhookId, IDs de instancia, e-mail nem telefone', () => {
      expect(WORKFLOW.nodes.every((n) => n.webhookId === undefined)).toBe(true);
      expect(TEXTO).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
      const semIdsDeNo = TEXTO.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        '',
      );
      expect(semIdsDeNo).not.toMatch(/\+?\d{2}\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/);
    });
  });

  describe('o n8n so orquestra', () => {
    it('so usa nos de entrada/saida de webhook, decisao e uma chamada HTTP', () => {
      const tipos = new Set(WORKFLOW.nodes.map((n) => n.type));

      expect(tipos).toEqual(
        new Set([
          'n8n-nodes-base.webhook',
          'n8n-nodes-base.if',
          'n8n-nodes-base.httpRequest',
          'n8n-nodes-base.respondToWebhook',
        ]),
      );
    });

    it('nenhum no de banco, de codigo, de comando, de Telegram ou de IA', () => {
      const tipos = WORKFLOW.nodes.map((n) => n.type).join(' ');

      expect(tipos).not.toMatch(
        /mysql|postgres|oracle|mongo|redis|executeCommand|\.code|telegram|openAi|langchain|agent|readWriteFile/i,
      );
      expect(TEXTO).not.toMatch(
        /mysql|postgres|oracle|mongo|redis|executeCommand|api\.telegram\.org/i,
      );
    });

    it('a UNICA URL do workflow e a de ingestao do backend', () => {
      const urls = TEXTO.match(/https?:\/\/[^"\s)]+/g) ?? [];

      expect(urls).toEqual([INGEST_URL]);
    });
  });

  describe('entrada', () => {
    const [webhook] = porTipo('n8n-nodes-base.webhook');

    it('um unico webhook POST, de producao, que responde por no (nao antes)', () => {
      expect(porTipo('n8n-nodes-base.webhook')).toHaveLength(1);
      expect(webhook?.parameters).toMatchObject({
        httpMethod: 'POST',
        path: 'vastaflow-telegram',
        responseMode: 'responseNode',
      });
    });

    it('nenhum no usa texto da mensagem em expressao fora do repasse do envelope', () => {
      const expressoes = TEXTO.match(/\{\{[^}]*\}\}/g) ?? [];

      for (const expressao of expressoes) {
        expect(expressao).toMatch(
          /\$json\.(body\.(envelope|signature)|statusCode|body)|JSON\.stringify|typeof/,
        );
        expect(expressao).not.toMatch(/\.text|\.userId|\.chatId|\.role|actor|permission/i);
      }
    });
  });

  describe('chamada ao backend', () => {
    const [http] = porTipo('n8n-nodes-base.httpRequest');
    const parametros = http?.parameters ?? {};

    it('POST na rota de servico, autenticada por credencial do cofre (Header Auth)', () => {
      expect(porTipo('n8n-nodes-base.httpRequest')).toHaveLength(1);
      expect(parametros).toMatchObject({
        method: 'POST',
        url: INGEST_URL,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
      });
      expect(Object.keys(http?.credentials ?? {})).toEqual(['httpHeaderAuth']);
    });

    it('repassa SO envelope e assinatura (nada de role, actorUserId, permissions)', () => {
      const corpo = String(parametros.jsonBody);

      expect(corpo).toBe(
        '={{ JSON.stringify({ envelope: $json.body.envelope, signature: $json.body.signature }) }}',
      );
      expect(corpo).not.toMatch(/role|actor|permission|usuario|admin/i);
    });

    it('sem repeticao automatica, sem seguir redirect e com limite de tempo', () => {
      expect(http?.retryOnFail).toBe(false);
      expect(JSON.stringify(parametros.options)).toContain('"followRedirects":false');
      expect(JSON.stringify(parametros.options)).toContain('"timeout":30000');
    });

    it('falha de rede/HTTP nao derruba o fluxo: segue para a resposta', () => {
      expect((http as unknown as { onError: string }).onError).toBe('continueRegularOutput');
    });
  });

  describe('saida', () => {
    it('TODO caminho termina em uma resposta ao webhook', () => {
      const respostas = new Set(porTipo('n8n-nodes-base.respondToWebhook').map((n) => n.name));
      const destinos = (nome: string): string[] =>
        (WORKFLOW.connections[nome]?.main ?? []).flat().map((c) => c.node);

      const terminaEmResposta = (nome: string, visitados = new Set<string>()): boolean => {
        if (respostas.has(nome)) {
          return true;
        }
        if (visitados.has(nome)) {
          return false;
        }
        visitados.add(nome);
        const proximos = destinos(nome);
        const saidas = WORKFLOW.connections[nome]?.main ?? [];
        // Todo no que nao e resposta precisa ter saida em todas as portas.
        const portas = saidas.length;
        return (
          portas > 0 &&
          saidas.every((porta) => porta.length > 0) &&
          proximos.every((p) => terminaEmResposta(p, new Set(visitados)))
        );
      };

      expect(respostas.size).toBe(2);
      expect(terminaEmResposta('Receber envelope')).toBe(true);
    });

    it('a resposta de falha e fixa e nao carrega dado do backend nem da mensagem', () => {
      const indisponivel = WORKFLOW.nodes.find((n) => n.name === 'Indisponivel');

      expect(indisponivel?.parameters.responseBody).toBe('{"outcome":"UNAVAILABLE"}');
    });

    it('a resposta de sucesso repassa o corpo do backend sem alterar', () => {
      const ok = WORKFLOW.nodes.find((n) => n.name === 'Devolver resposta do backend');

      expect(ok?.parameters.responseBody).toBe('={{ JSON.stringify($json.body) }}');
    });
  });

  describe('o n8n nao guarda conteudo', () => {
    it('as execucoes (sucesso, erro, manual, progresso) nao salvam dados', () => {
      expect(WORKFLOW.settings).toMatchObject({
        saveDataSuccessExecution: 'none',
        saveDataErrorExecution: 'none',
        saveManualExecutions: false,
        saveExecutionProgress: false,
      });
    });

    it('tem timeout de execucao', () => {
      expect(WORKFLOW.settings.executionTimeout).toBe(60);
    });
  });
});
