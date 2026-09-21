import { AUDIT_METADATA_MAX_LENGTH, REDACTED, sanitizeAuditMetadata } from './audit-metadata';

describe('sanitizeAuditMetadata', () => {
  it('devolve null quando nao ha metadados', () => {
    expect(sanitizeAuditMetadata(undefined)).toBeNull();
  });

  it('preserva dados comuns, inclusive aninhados', () => {
    const metadata = { motivo: 'CREDENCIAIS_INVALIDAS', origem: { canal: 'api', tentativa: 2 } };

    expect(sanitizeAuditMetadata(metadata)).toEqual(metadata);
  });

  it('remove valores de chaves sensiveis em qualquer nivel', () => {
    const result = sanitizeAuditMetadata({
      senha: 'Senha1234',
      usuario: { email: 'usuario@example.com', password: 'x', api_key: 'k', accessToken: 't' },
      headers: { Authorization: 'Bearer abc', cookie: 'sid=1' },
      jwt_secret: 's',
    });

    expect(result).toEqual({
      senha: REDACTED,
      usuario: {
        email: 'usuario@example.com',
        password: REDACTED,
        api_key: REDACTED,
        accessToken: REDACTED,
      },
      headers: { Authorization: REDACTED, cookie: REDACTED },
      jwt_secret: REDACTED,
    });
    expect(JSON.stringify(result)).not.toMatch(/Senha1234|Bearer abc|sid=1/);
  });

  it('converte valores que o JSON nao representa', () => {
    const circular: Record<string, unknown> = { nome: 'raiz' };
    circular.self = circular;

    expect(
      sanitizeAuditMetadata({
        total: 10n,
        erro: new Error('falhou'),
        circular,
      }),
    ).toEqual({
      total: '10',
      erro: { name: 'Error', message: 'falhou' },
      circular: { nome: 'raiz', self: '[Circular]' },
    });
  });

  it('nao grava a stack de erros', () => {
    const result = sanitizeAuditMetadata({ erro: new Error('x') });

    expect(JSON.stringify(result)).not.toContain('at ');
  });

  it('descarta metadados grandes demais em vez de quebrar a gravacao', () => {
    const result = sanitizeAuditMetadata({ dump: 'a'.repeat(AUDIT_METADATA_MAX_LENGTH) });

    expect(result).toEqual({
      _aviso: 'metadados excederam o tamanho maximo e foram descartados',
      _tamanhoOriginal: expect.any(Number) as number,
    });
    expect(JSON.stringify(result).length).toBeLessThan(AUDIT_METADATA_MAX_LENGTH);
  });

  it('nao lanca excecao com valores nao serializaveis', () => {
    const hostile = {
      toJSON(): never {
        throw new Error('boom');
      },
    };

    expect(sanitizeAuditMetadata({ hostile })).toEqual({ _aviso: 'metadados nao serializaveis' });
  });
});
