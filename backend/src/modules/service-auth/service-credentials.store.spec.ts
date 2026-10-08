import { Logger } from '@nestjs/common';
import { serializeCredentialsFile, type ServiceCredentialRecord } from './service-credentials.file';
import { ServiceCredentialsStore } from './service-credentials.store';
import { SERVICE_PRINCIPALS, ServicePrincipalId, ServiceScope } from './service-principals';
import { generateServiceToken, hashServiceToken } from './service-token';

const AGORA = Date.parse('2026-10-08T12:00:00.000Z');

function registro(
  token: string,
  over: Partial<ServiceCredentialRecord> = {},
): ServiceCredentialRecord {
  return {
    id: 'n8n-2026-10',
    principal: ServicePrincipalId.N8n,
    sha256: hashServiceToken(token),
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

function conteudo(...credentials: ServiceCredentialRecord[]): string {
  return serializeCredentialsFile({ version: 1, credentials });
}

/** Store com arquivo e relogio falsos: o teste controla o disco e o tempo. */
function criar(inicial: string | Error): {
  store: ServiceCredentialsStore;
  estado: { texto: string | Error; agora: number; leituras: number };
} {
  const estado = { texto: inicial, agora: AGORA, leituras: 0 };
  const store = new ServiceCredentialsStore({
    path: '/credenciais.json',
    ttlMs: 1000,
    now: () => estado.agora,
    readFile: () => {
      estado.leituras += 1;
      if (estado.texto instanceof Error) {
        throw estado.texto;
      }
      return estado.texto;
    },
  });
  return { store, estado };
}

describe('ServiceCredentialsStore', () => {
  let logLog: jest.SpyInstance<void, unknown[]>;
  let logError: jest.SpyInstance<void, unknown[]>;

  beforeEach(() => {
    logLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('autenticacao', () => {
    it('aceita um token ativo e devolve principal, credencial e escopos', () => {
      const token = generateServiceToken();
      const { store } = criar(conteudo(registro(token)));

      const resultado = store.find(token);

      expect(resultado).toEqual({
        ok: true,
        service: {
          principal: ServicePrincipalId.N8n,
          credentialId: 'n8n-2026-10',
          scopes: SERVICE_PRINCIPALS[ServicePrincipalId.N8n].scopes,
        },
      });
    });

    it('os escopos vem do CODIGO, nao do arquivo', () => {
      // O arquivo nao tem campo de escopo (o parser recusaria). Quem decide o que
      // o n8n pode fazer e `service-principals.ts`, que passa por revisao.
      const token = generateServiceToken();
      const { store } = criar(conteudo(registro(token)));
      const resultado = store.find(token);

      expect(resultado.ok && resultado.service.scopes).toEqual([ServiceScope.Identity]);
    });

    it('recusa um token desconhecido', () => {
      const { store } = criar(conteudo(registro(generateServiceToken())));

      expect(store.find(generateServiceToken())).toEqual({ ok: false, reason: 'unknown' });
    });

    it('recusa um token revogado', () => {
      const token = generateServiceToken();
      const { store } = criar(conteudo(registro(token, { status: 'revoked' })));

      expect(store.find(token)).toEqual({ ok: false, reason: 'revoked' });
    });

    it('recusa um token expirado, inclusive no instante exato da expiracao', () => {
      const token = generateServiceToken();
      const expiresAt = new Date(AGORA).toISOString();
      const { store } = criar(conteudo(registro(token, { expiresAt })));

      // `<=`: no instante exato ja nao vale. Aceitar nesse instante abriria uma
      // janela de 1 ms depois da expiracao, pequena, mas sem motivo para existir.
      expect(store.find(token)).toEqual({ ok: false, reason: 'expired' });
    });

    it('aceita um token cuja expiracao ainda nao chegou', () => {
      const token = generateServiceToken();
      const expiresAt = new Date(AGORA + 1).toISOString();
      const { store } = criar(conteudo(registro(token, { expiresAt })));

      expect(store.find(token).ok).toBe(true);
    });

    it('expira SOZINHO com o passar do tempo, sem mudar o arquivo', () => {
      const token = generateServiceToken();
      const expiresAt = new Date(AGORA + 5000).toISOString();
      const { store, estado } = criar(conteudo(registro(token, { expiresAt })));

      expect(store.find(token).ok).toBe(true);
      estado.agora = AGORA + 6000;
      expect(store.find(token)).toEqual({ ok: false, reason: 'expired' });
    });

    it('um token revogado NAO autentica mesmo que o hash esteja la', () => {
      // O hash casa, mas o status manda. Garante que o `status` e consultado e
      // nao so a presenca do hash.
      const token = generateServiceToken();
      const { store } = criar(
        conteudo(registro(token, { status: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z' })),
      );

      expect(store.find(token).ok).toBe(false);
    });
  });

  describe('rotacao: duas credenciais ativas ao mesmo tempo', () => {
    it('as duas autenticam, cada uma com o seu id', () => {
      const antigo = generateServiceToken();
      const novo = generateServiceToken();
      const { store } = criar(
        conteudo(registro(antigo, { id: 'n8n-2026-09' }), registro(novo, { id: 'n8n-2026-10' })),
      );

      const a = store.find(antigo);
      const n = store.find(novo);

      expect(a.ok && a.service.credentialId).toBe('n8n-2026-09');
      expect(n.ok && n.service.credentialId).toBe('n8n-2026-10');
    });

    it('revogar a antiga mantem a nova funcionando', () => {
      const antigo = generateServiceToken();
      const novo = generateServiceToken();
      const { store } = criar(
        conteudo(
          registro(antigo, { id: 'n8n-2026-09', status: 'revoked' }),
          registro(novo, { id: 'n8n-2026-10' }),
        ),
      );

      expect(store.find(antigo)).toEqual({ ok: false, reason: 'revoked' });
      expect(store.find(novo).ok).toBe(true);
    });

    it('acha a credencial em qualquer posicao da lista', () => {
      const tokens = Array.from({ length: 5 }, () => generateServiceToken());
      const { store } = criar(
        conteudo(...tokens.map((t, i) => registro(t, { id: `n8n-cred-${i}` }))),
      );

      tokens.forEach((token, i) => {
        const r = store.find(token);
        expect(r.ok && r.service.credentialId).toBe(`n8n-cred-${i}`);
      });
    });
  });

  describe('revogacao SEM reiniciar', () => {
    it('depois do TTL, a mudanca no arquivo vale; antes dele, ainda nao', () => {
      const token = generateServiceToken();
      const { store, estado } = criar(conteudo(registro(token)));

      expect(store.find(token).ok).toBe(true);

      // O operador revoga: grava o arquivo.
      estado.texto = conteudo(registro(token, { status: 'revoked' }));

      // Dentro do TTL o cache ainda vale - e esse e o teto da latencia.
      estado.agora = AGORA + 999;
      expect(store.find(token).ok).toBe(true);

      // No TTL, o arquivo e lido de novo e a revogacao vale. Mesmo objeto
      // `store`: nada foi reiniciado nem recriado.
      estado.agora = AGORA + 1000;
      expect(store.find(token)).toEqual({ ok: false, reason: 'revoked' });
    });

    it('relê o arquivo no maximo uma vez por janela de TTL', () => {
      const token = generateServiceToken();
      const { store, estado } = criar(conteudo(registro(token)));

      for (let i = 0; i < 50; i += 1) {
        store.find(token);
      }
      expect(estado.leituras).toBe(1);

      estado.agora = AGORA + 1000;
      for (let i = 0; i < 50; i += 1) {
        store.find(token);
      }
      expect(estado.leituras).toBe(2);
    });
  });

  describe('falha FECHADA', () => {
    it('arquivo ilegivel nega tudo', () => {
      const token = generateServiceToken();
      const { store } = criar(new Error('EACCES'));

      expect(store.find(token)).toEqual({ ok: false, reason: 'store_unavailable' });
    });

    it('arquivo apagado depois de funcionar nega tudo (apagar tambem revoga)', () => {
      const token = generateServiceToken();
      const { store, estado } = criar(conteudo(registro(token)));
      expect(store.find(token).ok).toBe(true);

      estado.texto = new Error('ENOENT');
      estado.agora = AGORA + 1000;

      expect(store.find(token)).toEqual({ ok: false, reason: 'store_unavailable' });
    });

    it('arquivo corrompido nega tudo', () => {
      const token = generateServiceToken();
      const { store } = criar('{ isto nao e json');

      expect(store.find(token)).toEqual({ ok: false, reason: 'store_invalid' });
    });

    it('NAO mantem a "ultima versao boa" quando o arquivo passa a ser invalido', () => {
      // O caso que importa: o operador revoga, a gravacao sai quebrada. Se o
      // store continuasse com a copia antiga, a credencial que ele ACABOU DE
      // REVOGAR voltaria a valer. Aqui ela deixa de valer.
      const token = generateServiceToken();
      const { store, estado } = criar(conteudo(registro(token)));
      expect(store.find(token).ok).toBe(true);

      estado.texto = '{ gravacao pela metade';
      estado.agora = AGORA + 1000;

      expect(store.find(token)).toEqual({ ok: false, reason: 'store_invalid' });
    });

    it('arquivo com campo desconhecido nega tudo', () => {
      const token = generateServiceToken();
      const texto = JSON.stringify({
        version: 1,
        credentials: [{ ...registro(token), statuss: 'revoked' }],
      });
      const { store } = criar(texto);

      expect(store.find(token)).toEqual({ ok: false, reason: 'store_invalid' });
    });

    it('recupera sozinho quando o arquivo volta a ser valido', () => {
      const token = generateServiceToken();
      const { store, estado } = criar('{ quebrado');
      expect(store.find(token).ok).toBe(false);

      estado.texto = conteudo(registro(token));
      estado.agora = AGORA + 1000;

      expect(store.find(token).ok).toBe(true);
    });

    it('sem caminho configurado o recurso esta DESLIGADO e nega tudo', () => {
      const store = new ServiceCredentialsStore({ path: undefined });

      expect(store.find(generateServiceToken())).toEqual({ ok: false, reason: 'not_configured' });
    });

    it('arquivo vazio de credenciais nega tudo', () => {
      const { store } = criar(conteudo());

      expect(store.find(generateServiceToken())).toEqual({ ok: false, reason: 'unknown' });
    });
  });

  describe('log', () => {
    it('registra o estado carregado UMA vez, nao a cada requisicao', () => {
      const token = generateServiceToken();
      const { store } = criar(conteudo(registro(token)));

      for (let i = 0; i < 20; i += 1) {
        store.find(token);
      }

      expect(logLog).toHaveBeenCalledTimes(1);
    });

    it('o resumo nomeia as credenciais ativas e NAO traz hash nem token', () => {
      const token = generateServiceToken();
      const { store } = criar(
        conteudo(
          registro(token),
          registro(generateServiceToken(), { id: 'n8n-velha', status: 'revoked' }),
        ),
      );

      store.find(token);

      const mensagem = String(logLog.mock.calls[0]?.[0]);
      expect(mensagem).toContain('n8n/n8n-2026-10');
      expect(mensagem).toContain('revogadas=1');
      expect(mensagem).not.toContain(hashServiceToken(token));
      expect(mensagem).not.toContain(token);
    });

    it('registra uma nova linha quando o conteudo MUDA (rastro de rotacao/revogacao)', () => {
      const token = generateServiceToken();
      const { store, estado } = criar(conteudo(registro(token)));
      store.find(token);

      estado.texto = conteudo(registro(token, { status: 'revoked' }));
      estado.agora = AGORA + 1000;
      store.find(token);

      expect(logLog).toHaveBeenCalledTimes(2);
      expect(String(logLog.mock.calls[1]?.[0])).toContain('revogadas=1');
    });

    it('arquivo invalido e registrado como erro, uma vez, sem expor o conteudo', () => {
      const hashDistintivo = 'f00dfeed'.repeat(8);
      const { store, estado } = criar(
        JSON.stringify({ version: 1, credentials: [{ id: 'n8n-x1', sha256: hashDistintivo }] }),
      );

      for (let i = 0; i < 10; i += 1) {
        store.find(generateServiceToken());
      }
      estado.agora = AGORA + 5000;
      store.find(generateServiceToken());

      expect(logError).toHaveBeenCalledTimes(1);
      expect(String(logError.mock.calls[0]?.[0])).not.toContain(hashDistintivo);
    });

    it('arquivo ausente e registrado como erro, uma vez', () => {
      const { store, estado } = criar(new Error('ENOENT: caminho/secreto'));

      store.find(generateServiceToken());
      estado.agora = AGORA + 5000;
      store.find(generateServiceToken());

      expect(logError).toHaveBeenCalledTimes(1);
      // O erro original (com caminho e errno) nao e repassado ao log.
      expect(String(logError.mock.calls[0]?.[0])).not.toContain('caminho/secreto');
    });
  });
});
