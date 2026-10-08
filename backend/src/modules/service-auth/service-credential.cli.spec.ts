import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './service-credential.cli';
import { parseCredentialsFile } from './service-credentials.file';
import { hashServiceToken, hasServiceTokenFormat } from './service-token';

const AGORA = new Date('2026-10-08T12:00:00.000Z');

describe('service-credential.cli', () => {
  let dir: string;
  let arquivo: string;
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-cli-'));
    arquivo = join(dir, 'credentials.json');
    stdout = [];
    stderr = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((texto) => {
      stdout.push(String(texto));
      return true;
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((texto) => {
      stderr.push(String(texto));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const criar = (id = 'n8n-2026-10', extra: string[] = []): number =>
    run(['create', '--file', arquivo, '--id', id, '--principal', 'n8n', ...extra], AGORA);

  it('create: imprime SO o token no stdout e grava SO o hash no arquivo', () => {
    expect(criar()).toBe(0);

    const token = stdout.join('').trim();
    expect(hasServiceTokenFormat(token)).toBe(true);
    const texto = readFileSync(arquivo, 'utf8');
    expect(texto).not.toContain(token);
    expect(parseCredentialsFile(texto).credentials[0]?.sha256).toBe(hashServiceToken(token));
  });

  it('create: os avisos vao para o stderr, nunca com o token', () => {
    criar();

    const token = stdout.join('').trim();
    expect(stderr.join('')).toContain('UMA vez');
    expect(stderr.join('')).not.toContain(token);
    expect(stdout.join('').trim().split('\n')).toHaveLength(1);
  });

  it('create: a gravacao e atomica (nao sobra arquivo temporario) e o modo permite leitura pelo container', () => {
    criar();

    expect(readdirSync(dir)).toEqual(['credentials.json']);
    if (process.platform !== 'win32') {
      expect(statSync(arquivo).mode & 0o777).toBe(0o644);
    }
  });

  it('create: janela de rotacao, duas credenciais no mesmo arquivo', () => {
    criar('n8n-2026-09');
    criar('n8n-2026-10');

    expect(parseCredentialsFile(readFileSync(arquivo, 'utf8')).credentials).toHaveLength(2);
  });

  it('create --expires-in-days grava a expiracao', () => {
    criar('n8n-2026-10', ['--expires-in-days', '30']);

    const [registro] = parseCredentialsFile(readFileSync(arquivo, 'utf8')).credentials;
    expect(registro?.expiresAt).toBe(new Date(AGORA.getTime() + 30 * 86_400_000).toISOString());
  });

  it('revoke: marca revogada sem apagar e imprime nada no stdout', () => {
    criar();
    stdout.length = 0;

    expect(run(['revoke', '--file', arquivo, '--id', 'n8n-2026-10'], AGORA)).toBe(0);

    const [registro] = parseCredentialsFile(readFileSync(arquivo, 'utf8')).credentials;
    expect(registro?.status).toBe('revoked');
    expect(stdout.join('')).toBe('');
  });

  it('list: mostra o estado e nunca o hash', () => {
    criar();
    const hash = parseCredentialsFile(readFileSync(arquivo, 'utf8')).credentials[0]?.sha256 ?? '';
    stdout.length = 0;

    expect(run(['list', '--file', arquivo], AGORA)).toBe(0);

    expect(stdout.join('')).toContain('ATIVA');
    expect(stdout.join('')).not.toContain(hash);
  });

  describe('erros devolvem codigo 1 e nao gravam nada', () => {
    it.each([
      ['comando desconhecido', ['apagar', '--file', 'x']],
      ['sem comando', []],
      ['falta --file', ['list']],
      ['flag sem valor', ['list', '--file']],
      [
        'principal desconhecido',
        ['create', '--file', 'x', '--id', 'n8n-2026', '--principal', 'whatsapp'],
      ],
    ])('%s', (_nome, argv) => {
      expect(run(argv, AGORA)).toBe(1);
      expect(stderr.join('')).toContain('erro:');
      expect(readdirSync(dir)).toEqual([]);
    });

    it('--expires-in-days nao numerico', () => {
      expect(criar('n8n-2026-10', ['--expires-in-days', 'abc'])).toBe(1);
      expect(readdirSync(dir)).toEqual([]);
    });

    it('revogar id inexistente', () => {
      criar();
      const antes = readFileSync(arquivo, 'utf8');

      expect(run(['revoke', '--file', arquivo, '--id', 'nao-existe'], AGORA)).toBe(1);

      expect(readFileSync(arquivo, 'utf8')).toBe(antes);
    });

    it('arquivo existente corrompido: recusa e NAO sobrescreve', () => {
      writeFileSync(arquivo, '{ corrompido');

      expect(criar()).toBe(1);

      expect(readFileSync(arquivo, 'utf8')).toBe('{ corrompido');
    });
  });
});
