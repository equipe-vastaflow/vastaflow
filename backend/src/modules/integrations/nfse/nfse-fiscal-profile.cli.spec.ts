import {
  approvedProfile,
  SYNTHETIC_TODAY,
  syntheticDraft,
} from '../../../../test/support/nfse-profile-fixtures';
import { run, type ProfileCliIo } from './nfse-fiscal-profile.cli';
import { profileContentHash } from './nfse-fiscal-profile';

/** CLI de apoio a aprovacao: perfis SINTETICOS, entrada e saida injetadas (nada toca disco ou rede). */
function io(content: string | Error): { io: ProfileCliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      read: () => {
        if (content instanceof Error) {
          throw content;
        }
        return content;
      },
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      today: () => SYNTHETIC_TODAY,
    },
  };
}
const file = (...perfis: unknown[]): string => JSON.stringify({ versaoEsquema: 1, perfis });

describe('NFS-e - CLI dos perfis fiscais', () => {
  it('check: perfil aprovado e integro aparece como UTILIZAVEL, com o hash do conteudo', () => {
    const h = io(file(approvedProfile()));

    expect(run(['check', 'perfis.json'], h.io)).toBe(0);
    expect(h.out).toEqual([
      `servico-sintetico v1 | aprovado | UTILIZAVEL | conteudoSha256: ${approvedProfile().aprovacao.conteudoSha256}`,
    ]);
  });

  it('check: rascunho e conteudo alterado depois da aprovacao saem como NAO utilizaveis (codigo 1)', () => {
    const draft = {
      ...syntheticDraft(),
      aprovacao: { status: 'rascunho', aprovadoPor: null, aprovadoEm: null, conteudoSha256: null },
    };
    const altered = {
      ...approvedProfile({ versao: 2 }),
      aprovacao: { ...approvedProfile().aprovacao, conteudoSha256: 'c'.repeat(64) },
    };
    const h = io(file(draft, altered));

    expect(run(['check', 'perfis.json'], h.io)).toBe(1);
    expect(h.out.join('\n')).toMatch(/ainda nao aprovado/);
    expect(h.out.join('\n')).toMatch(/conteudo alterado depois da aprovacao/);
  });

  it('check: o hash mostrado e o que a aprovacao precisa registrar', () => {
    const draft = syntheticDraft();
    const h = io(
      file({
        ...draft,
        aprovacao: {
          status: 'rascunho',
          aprovadoPor: null,
          aprovadoEm: null,
          conteudoSha256: null,
        },
      }),
    );

    run(['check', 'perfis.json'], h.io);

    expect(h.out[0]).toContain(`conteudoSha256: ${profileContentHash(draft)}`);
  });

  it('check: arquivo com problema lista o campo, nunca o valor, e sai com codigo 1', () => {
    const bad = {
      ...approvedProfile(),
      servico: { cTribNac: 'VALOR-RUIM', cTribMun: null, cNBS: '101011100' },
    };
    const h = io(file(bad));

    expect(run(['check', 'perfis.json'], h.io)).toBe(1);
    expect(h.err.join(' ')).toMatch(/cTribNac/);
    expect(h.err.join(' ')).not.toContain('VALOR-RUIM');
  });

  it('show: imprime o conteudo canonico (sem o bloco de aprovacao) e o hash', () => {
    const h = io(file(approvedProfile()));

    expect(run(['show', 'perfis.json', 'servico-sintetico', '1'], h.io)).toBe(0);
    expect(h.out).toHaveLength(2);
    expect(h.out[0]).not.toContain('aprovacao');
    expect(h.out[0]).toContain('"id":"servico-sintetico"');
    expect(h.out[1]).toBe(`conteudoSha256: ${approvedProfile().aprovacao.conteudoSha256}`);
  });

  it('check: perfil aprovado e integro mas incompativel com o gerador lista a regra e sai com codigo 1', () => {
    const base = syntheticDraft();
    const h = io(file(approvedProfile({ ibscbs: { ...base.ibscbs, indDest: 1 } })));

    expect(run(['check', 'perfis.json'], h.io)).toBe(1);
    expect(h.out.join('\n')).toMatch(/NAO utilizavel \(incompativel com o gerador de DPS/);
    expect(h.out.join('\n')).toMatch(/ {2}incompativel \[DEST-1\]/);
  });

  it('check: rascunho incompativel tambem e apontado (corrigir antes de pedir aprovacao)', () => {
    const base = syntheticDraft();
    const h = io(
      file({
        ...base,
        ibscbs: { ...base.ibscbs, cIndOp: '030101' },
        aprovacao: {
          status: 'rascunho',
          aprovadoPor: null,
          aprovadoEm: null,
          conteudoSha256: null,
        },
      }),
    );

    expect(run(['check', 'perfis.json'], h.io)).toBe(1);
    expect(h.out.join('\n')).toMatch(/incompativel \[OP-1\]/);
  });

  it('show: perfil incompativel NAO gera hash de aprovacao', () => {
    const base = syntheticDraft();
    const h = io(file(approvedProfile({ ibscbs: { ...base.ibscbs, tpOper: 2, tpEnteGov: 4 } })));

    expect(run(['show', 'perfis.json', 'servico-sintetico', '1'], h.io)).toBe(1);
    expect(h.out).toEqual([]);
    expect(h.err.join('\n')).toMatch(/incompativel \[REF-1\]/);
    expect(h.err.join('\n')).toMatch(/nenhum hash foi gerado/);
  });

  it('show: perfil inexistente ou sem id/versao', () => {
    expect(run(['show', 'perfis.json', 'outro', '1'], io(file(approvedProfile())).io)).toBe(1);
    expect(run(['show', 'perfis.json'], io(file(approvedProfile())).io)).toBe(2);
  });

  it.each([[[]], [['check']], [['apagar', 'x']]])(
    'uso incorreto (%j): codigo 2 e orientacao',
    (argv) => {
      const h = io('{}');

      expect(run(argv, h.io)).toBe(2);
      expect(h.err[0]).toMatch(/^uso:/);
    },
  );

  it('arquivo ilegivel ou JSON quebrado: mensagem fixa, sem caminho nem conteudo', () => {
    for (const content of [new Error('ENOENT /segredo/perfis.json'), '{ quebrado']) {
      const h = io(content);

      expect(run(['check', '/segredo/perfis.json'], h.io)).toBe(1);
      expect(h.err).toEqual(['erro: arquivo ilegivel ou JSON invalido']);
    }
  });
});
