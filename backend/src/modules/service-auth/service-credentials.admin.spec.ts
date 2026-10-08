import {
  addCredential,
  describeCredentials,
  EMPTY_CREDENTIALS_FILE,
  revokeCredential,
} from './service-credentials.admin';
import { parseCredentialsFile, serializeCredentialsFile } from './service-credentials.file';
import { ServicePrincipalId } from './service-principals';
import { hashServiceToken, hasServiceTokenFormat } from './service-token';

const AGORA = new Date('2026-10-08T12:00:00.000Z');

function criar(id = 'n8n-2026-10'): ReturnType<typeof addCredential> {
  return addCredential(EMPTY_CREDENTIALS_FILE, { id, principal: 'n8n', now: AGORA });
}

describe('addCredential', () => {
  it('cria uma credencial ativa e devolve o token UMA vez', () => {
    const { file, token } = criar();

    expect(hasServiceTokenFormat(token)).toBe(true);
    expect(file.credentials).toHaveLength(1);
    expect(file.credentials[0]).toMatchObject({
      id: 'n8n-2026-10',
      principal: ServicePrincipalId.N8n,
      status: 'active',
      createdAt: AGORA.toISOString(),
    });
  });

  it('grava o HASH do token, nunca o token', () => {
    const { file, token } = criar();

    expect(file.credentials[0]?.sha256).toBe(hashServiceToken(token));
    expect(serializeCredentialsFile(file)).not.toContain(token);
    expect(serializeCredentialsFile(file)).not.toContain(token.slice(4));
  });

  it('o arquivo resultante e aceito pelo parser (nao gera arquivo que o backend recusaria)', () => {
    const { file } = criar();

    expect(() => parseCredentialsFile(serializeCredentialsFile(file))).not.toThrow();
  });

  it('aceita expiracao futura', () => {
    const expiresAt = new Date(AGORA.getTime() + 86_400_000);
    const { file } = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-2026-10',
      principal: 'n8n',
      now: AGORA,
      expiresAt,
    });

    expect(file.credentials[0]?.expiresAt).toBe(expiresAt.toISOString());
  });

  it('janela de ROTACAO: uma segunda credencial do mesmo principal e permitida', () => {
    const primeira = criar('n8n-2026-09');
    const segunda = addCredential(primeira.file, {
      id: 'n8n-2026-10',
      principal: 'n8n',
      now: AGORA,
    });

    expect(segunda.file.credentials.map((c) => c.id)).toEqual(['n8n-2026-09', 'n8n-2026-10']);
    expect(segunda.file.credentials.every((c) => c.status === 'active')).toBe(true);
    expect(segunda.token).not.toBe(primeira.token);
  });

  it('nao altera o arquivo de entrada', () => {
    const { file } = criar();
    const antes = serializeCredentialsFile(file);

    addCredential(file, { id: 'n8n-2026-11', principal: 'n8n', now: AGORA });

    expect(serializeCredentialsFile(file)).toBe(antes);
  });

  it.each([
    ['id vazio', ''],
    ['id curto', 'ab'],
    ['id com maiuscula', 'N8N-2026'],
    ['id com espaco', 'n8n 2026'],
    ['id com barra', 'n8n/2026'],
  ])('recusa %s', (_nome, id) => {
    expect(() =>
      addCredential(EMPTY_CREDENTIALS_FILE, { id, principal: 'n8n', now: AGORA }),
    ).toThrow(/id invalido/);
  });

  it('recusa principal desconhecido', () => {
    expect(() =>
      addCredential(EMPTY_CREDENTIALS_FILE, {
        id: 'whats-2026',
        principal: 'whatsapp',
        now: AGORA,
      }),
    ).toThrow(/principal desconhecido/);
  });

  it('recusa id repetido', () => {
    const { file } = criar();

    expect(() => addCredential(file, { id: 'n8n-2026-10', principal: 'n8n', now: AGORA })).toThrow(
      /ja existe/,
    );
  });

  it('recusa expiracao no passado ou no proprio instante', () => {
    for (const expiresAt of [new Date(AGORA.getTime() - 1), AGORA]) {
      expect(() =>
        addCredential(EMPTY_CREDENTIALS_FILE, {
          id: 'n8n-2026-10',
          principal: 'n8n',
          now: AGORA,
          expiresAt,
        }),
      ).toThrow(/futura/);
    }
  });

  it('usa o gerador injetado', () => {
    const { token } = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-2026-10',
      principal: 'n8n',
      now: AGORA,
      generate: () => 'token-fixo-de-teste',
    });

    expect(token).toBe('token-fixo-de-teste');
  });
});

describe('revokeCredential', () => {
  const DEPOIS = new Date('2026-10-09T08:00:00.000Z');

  it('marca como revogada e registra quando', () => {
    const { file } = criar();

    const revogado = revokeCredential(file, 'n8n-2026-10', DEPOIS);

    expect(revogado.credentials[0]).toMatchObject({
      status: 'revoked',
      revokedAt: DEPOIS.toISOString(),
    });
  });

  it('NAO apaga o registro: preserva o rastro de que a credencial existiu', () => {
    const { file } = criar();

    expect(revokeCredential(file, 'n8n-2026-10', DEPOIS).credentials).toHaveLength(1);
  });

  it('mantem o hash (o token revogado continua sendo RECONHECIDO e recusado como revogado)', () => {
    const { file, token } = criar();

    expect(revokeCredential(file, 'n8n-2026-10', DEPOIS).credentials[0]?.sha256).toBe(
      hashServiceToken(token),
    );
  });

  it('nao toca as outras credenciais', () => {
    const a = criar('n8n-2026-09');
    const b = addCredential(a.file, { id: 'n8n-2026-10', principal: 'n8n', now: AGORA });

    const revogado = revokeCredential(b.file, 'n8n-2026-09', DEPOIS);

    expect(revogado.credentials[0]?.status).toBe('revoked');
    expect(revogado.credentials[1]).toEqual(b.file.credentials[1]);
  });

  it('e idempotente e preserva a data ORIGINAL da revogacao', () => {
    const { file } = criar();
    const primeira = revokeCredential(file, 'n8n-2026-10', DEPOIS);
    const muitoDepois = new Date('2026-12-01T00:00:00.000Z');

    const segunda = revokeCredential(primeira, 'n8n-2026-10', muitoDepois);

    expect(segunda.credentials[0]?.revokedAt).toBe(DEPOIS.toISOString());
  });

  it('recusa id inexistente', () => {
    const { file } = criar();

    expect(() => revokeCredential(file, 'nao-existe', DEPOIS)).toThrow(/nao existe/);
  });

  it('nao altera o arquivo de entrada', () => {
    const { file } = criar();
    const antes = serializeCredentialsFile(file);

    revokeCredential(file, 'n8n-2026-10', DEPOIS);

    expect(serializeCredentialsFile(file)).toBe(antes);
  });

  it('o arquivo resultante e aceito pelo parser', () => {
    const { file } = criar();

    expect(() =>
      parseCredentialsFile(serializeCredentialsFile(revokeCredential(file, 'n8n-2026-10', DEPOIS))),
    ).not.toThrow();
  });
});

describe('describeCredentials', () => {
  it('informa o estado de cada credencial e NUNCA o hash', () => {
    const a = criar('n8n-2026-09');
    const b = addCredential(a.file, {
      id: 'n8n-2026-10',
      principal: 'n8n',
      now: AGORA,
      expiresAt: new Date(AGORA.getTime() + 86_400_000),
    });
    const c = addCredential(b.file, { id: 'n8n-2026-11', principal: 'n8n', now: AGORA });
    const file = revokeCredential(c.file, 'n8n-2026-09', AGORA);

    const linhas = describeCredentials(file, AGORA);

    expect(linhas[0]).toContain('REVOGADA');
    expect(linhas[1]).toContain('ATIVA');
    expect(linhas[1]).toContain('expira=');
    for (const linha of linhas) {
      for (const record of file.credentials) {
        expect(linha).not.toContain(record.sha256);
      }
    }
  });

  it('marca como EXPIRADA uma credencial ativa vencida', () => {
    const { file } = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-2026-10',
      principal: 'n8n',
      now: AGORA,
      expiresAt: new Date(AGORA.getTime() + 1000),
    });

    expect(describeCredentials(file, new Date(AGORA.getTime() + 2000))[0]).toContain('EXPIRADA');
  });

  it('lista vazia', () => {
    expect(describeCredentials(EMPTY_CREDENTIALS_FILE, AGORA)).toEqual(['(nenhuma credencial)']);
  });
});
