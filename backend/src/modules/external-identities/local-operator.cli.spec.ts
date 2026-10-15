import { AuditAction } from '../audit/audit-action.enum';
import { run, type OperatorCliDeps, type OperatorPorts, type Prompter } from './local-operator.cli';

const SENHA = 'SenhaForte123';
const EXPIRA = new Date('2026-10-14T12:15:00Z');

interface Montagem {
  deps: OperatorCliDeps;
  saida: string[];
  erros: string[];
  createOperator: jest.Mock<
    Promise<{ id: string }>,
    [{ nome: string; email: string; senha: string }]
  >;
  createLinkRequest: jest.Mock<
    Promise<{ id: string; codigo: string; expiraEm: Date }>,
    [string, string]
  >;
  audit: jest.Mock<Promise<void>, [AuditAction, string, Record<string, string>]>;
  findByEmail: jest.Mock<Promise<{ id: string; ativo: boolean; role: string } | null>, [string]>;
}

function montar(
  opcoes: {
    interactive?: boolean;
    respostas?: string[];
    segredos?: string[];
    existente?: { id: string; ativo: boolean; role: string } | null;
  } = {},
): Montagem {
  const respostas = [...(opcoes.respostas ?? ['Teste@Vasta.Test', 'Pessoa de Teste'])];
  const segredos = [...(opcoes.segredos ?? [SENHA, SENHA])];
  const findByEmail = jest.fn((_email: string) => Promise.resolve(opcoes.existente ?? null));
  const createOperator = jest.fn((_i: { nome: string; email: string; senha: string }) =>
    Promise.resolve({ id: 'user-1' }),
  );
  const createLinkRequest = jest.fn((_u: string, _c: string) =>
    Promise.resolve({ id: 'req-1', codigo: 'ABCD-EFGH-JKLM', expiraEm: EXPIRA }),
  );
  const audit = jest.fn((_a: AuditAction, _u: string, _m: Record<string, string>) =>
    Promise.resolve(),
  );
  const ports: OperatorPorts = { findByEmail, createOperator, createLinkRequest, audit };
  const prompt: Prompter = {
    interactive: opcoes.interactive ?? true,
    ask: () => Promise.resolve(respostas.shift() ?? ''),
    askSecret: () => Promise.resolve(segredos.shift() ?? ''),
  };
  const saida: string[] = [];
  const erros: string[] = [];
  return {
    saida,
    erros,
    createOperator,
    createLinkRequest,
    audit,
    findByEmail,
    deps: { ports, prompt, out: (t) => saida.push(t), err: (t) => erros.push(t) },
  };
}

describe('local-operator CLI', () => {
  describe('exige terminal interativo (senha nunca por pipe, argumento ou env)', () => {
    it.each([['create-operator'], ['link-code', '--email', 'a@b.co']])(
      '%s sem TTY: recusa',
      async (...argv) => {
        const m = montar({ interactive: false });

        expect(await run(argv, m.deps)).toBe(1);
        expect(m.createOperator).not.toHaveBeenCalled();
        expect(m.createLinkRequest).not.toHaveBeenCalled();
        expect(m.erros.join('\n')).toContain('terminal interativo');
      },
    );
  });

  describe('create-operator', () => {
    it('cria SEMPRE um OPERADOR, com e-mail normalizado, e audita sem a senha', async () => {
      const m = montar();

      expect(await run(['create-operator'], m.deps)).toBe(0);

      expect(m.createOperator).toHaveBeenCalledWith({
        nome: 'Pessoa de Teste',
        email: 'teste@vasta.test',
        senha: SENHA,
      });
      expect(m.audit).toHaveBeenCalledWith(AuditAction.UserCreated, 'user-1', {
        origem: 'cli-local',
        perfil: 'OPERADOR',
      });
      const tudo = JSON.stringify([m.saida, m.erros, m.audit.mock.calls]);
      expect(tudo).not.toContain(SENHA);
    });

    it('nao ha como pedir outro perfil: argumentos sao recusados', async () => {
      for (const extra of [['--role', 'ADMIN'], ['ADMIN'], ['--email', 'x@y.co']]) {
        const m = montar();

        expect(await run(['create-operator', ...extra], m.deps)).toBe(1);
        expect(m.createOperator).not.toHaveBeenCalled();
      }
    });

    it('a entrada de criacao nao tem campo de perfil', async () => {
      const m = montar();
      await run(['create-operator'], m.deps);

      const entrada = m.createOperator.mock.calls[0]?.[0] ?? {};
      expect(Object.keys(entrada).sort()).toEqual(['email', 'nome', 'senha']);
    });

    it.each([
      ['e-mail invalido', { respostas: ['nao-e-email', 'Nome Ok'] }],
      ['nome curto', { respostas: ['a@b.co', 'x'] }],
      ['senha fraca', { segredos: ['fraca', 'fraca'] }],
      ['senhas diferentes', { segredos: [SENHA, 'OutraSenha123'] }],
      ['e-mail ja cadastrado', { existente: { id: 'u', ativo: true, role: 'OPERADOR' } }],
    ])('%s: recusa e nada e criado', async (_nome, opcoes) => {
      const m = montar(opcoes);

      expect(await run(['create-operator'], m.deps)).toBe(1);
      expect(m.createOperator).not.toHaveBeenCalled();
      expect(m.audit).not.toHaveBeenCalled();
    });

    it('a mensagem de senha fraca nao repete a senha digitada', async () => {
      const m = montar({ segredos: ['fraca', 'fraca'] });

      await run(['create-operator'], m.deps);

      expect(m.erros.join('\n')).not.toContain('fraca');
    });
  });

  describe('link-code', () => {
    const alvo = { id: 'user-1', ativo: true, role: 'OPERADOR' };

    it('gera o codigo UMA vez no terminal, audita SEM o codigo e fala do prazo', async () => {
      const m = montar({ existente: alvo });

      expect(await run(['link-code', '--email', 'Teste@Vasta.Test'], m.deps)).toBe(0);

      expect(m.findByEmail).toHaveBeenCalledWith('teste@vasta.test');
      expect(m.saida.join('\n')).toContain('/vincular ABCD-EFGH-JKLM');
      expect(m.saida.join('\n')).toContain('NAO sera mostrado de novo');
      expect(JSON.stringify(m.audit.mock.calls)).not.toContain('ABCD-EFGH-JKLM');
      expect(m.audit).toHaveBeenCalledWith(AuditAction.ExternalIdentityLinkRequested, 'user-1', {
        origem: 'cli-local',
        canal: 'telegram',
        solicitacaoId: 'req-1',
      });
    });

    it.each([
      ['usuario inexistente', null],
      ['usuario inativo', { id: 'u', ativo: false, role: 'OPERADOR' }],
      ['ADMIN (nunca por este procedimento)', { id: 'u', ativo: true, role: 'ADMIN' }],
    ])('%s: recusa sem gerar codigo', async (_nome, existente) => {
      const m = montar({ existente });

      expect(await run(['link-code', '--email', 'a@b.co'], m.deps)).toBe(1);
      expect(m.createLinkRequest).not.toHaveBeenCalled();
      expect(m.saida.join('\n')).not.toContain('/vincular');
    });

    it('--canal whatsapp: gera o pedido para o WhatsApp e orienta o envio ao numero da empresa', async () => {
      const m = montar({ existente: alvo });

      expect(await run(['link-code', '--email', 'a@b.co', '--canal', 'whatsapp'], m.deps)).toBe(0);

      expect(m.createLinkRequest).toHaveBeenCalledWith('user-1', 'whatsapp');
      expect(m.saida.join(String.fromCharCode(10))).toContain('WHATSAPP');
      expect(m.audit.mock.calls[0]?.[2]).toMatchObject({ canal: 'whatsapp' });
    });

    it('sem --canal o padrao continua sendo o Telegram', async () => {
      const m = montar({ existente: alvo });

      await run(['link-code', '--email', 'a@b.co'], m.deps);

      expect(m.createLinkRequest).toHaveBeenCalledWith('user-1', 'telegram');
    });

    it.each([['sms'], ['TELEGRAM'], ['']])('canal desconhecido (%p): recusado', async (canal) => {
      const m = montar({ existente: alvo });

      expect(await run(['link-code', '--email', 'a@b.co', '--canal', canal], m.deps)).toBe(1);
      expect(m.createLinkRequest).not.toHaveBeenCalled();
    });

    it.each([
      [['link-code']],
      [['link-code', '--email']],
      [['link-code', 'a@b.co']],
      [['link-code', '--codigo', 'x']],
    ])('uso invalido (%j)', async (argv) => {
      const m = montar({ existente: alvo });

      expect(await run(argv, m.deps)).toBe(1);
      expect(m.createLinkRequest).not.toHaveBeenCalled();
    });
  });

  it('comando desconhecido e falha interna: codigo 1, sem detalhe', async () => {
    const m = montar();
    m.createOperator.mockRejectedValueOnce(new Error('ER_ACCESS senha=SEGREDO-BANCO'));

    expect(await run(['faz-tudo'], m.deps)).toBe(1);
    expect(await run(['create-operator'], m.deps)).toBe(1);
    expect(m.erros.join('\n')).not.toContain('SEGREDO-BANCO');
    expect(m.erros.join('\n')).toContain('falha ao executar');
  });
});
