import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  approvedProfile,
  SYNTHETIC_SERVICE,
  SYNTHETIC_TODAY,
  syntheticDraft,
} from '../../../../test/support/nfse-profile-fixtures';
import {
  applyPercent,
  buildFiscalSnapshot,
  canonicalJson,
  checkProfile,
  normalizePercent,
  parseFiscalProfiles,
  profileContentHash,
  selectProfile,
  type NfseFiscalProfile,
} from './nfse-fiscal-profile';
import { loadFiscalProfiles, PROFILES_FILE_MAX_BYTES } from './nfse-fiscal-profile.loader';

/** Perfis fiscais: tudo com dados SINTETICOS (ver `test/support/nfse-profile-fixtures.ts`). */
const file = (...perfis: unknown[]): unknown => ({ versaoEsquema: 1, perfis });
const withApproval = (over: Partial<NfseFiscalProfile['aprovacao']>): NfseFiscalProfile => ({
  ...approvedProfile(),
  aprovacao: { ...approvedProfile().aprovacao, ...over },
});

describe('NFS-e - perfil fiscal: conteudo canonico e hash da aprovacao', () => {
  it('JSON canonico: chaves em ordem, independente da ordem de entrada', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('o hash cobre todo o conteudo e IGNORA o bloco de aprovacao', () => {
    const base = approvedProfile();
    expect(profileContentHash(base)).toBe(base.aprovacao.conteudoSha256);
    expect(
      profileContentHash({ ...base, aprovacao: { ...base.aprovacao, status: 'rascunho' } }),
    ).toBe(profileContentHash(base));
  });

  it.each([
    ['descricao', { descricao: 'outra' }],
    ['versao', { versao: 2 }],
    ['cTribNac', { servico: { ...syntheticDraft().servico, cTribNac: '990102' } }],
    ['cNBS', { servico: { ...syntheticDraft().servico, cNBS: '188888889' } }],
    ['cClassTrib', { ibscbs: { ...syntheticDraft().ibscbs, cClassTrib: '288889' } }],
    ['retencao', { tribFed: null }],
    ['totTrib', { totTrib: { tipo: 'indicador' as const } }],
    ['permitidos', { permitidos: { tribIssqn: [1 as const], tpRetIssqn: [1 as const] } }],
    ['endereco', { tomador: { exigeEndereco: false } }],
  ])('alterar %s muda o hash (a aprovacao nao se aplica a outro conteudo)', (_campo, over) => {
    expect(profileContentHash(syntheticDraft(over as never))).not.toBe(
      profileContentHash(syntheticDraft()),
    );
  });
});

describe('NFS-e - perfil fiscal: leitura e validacao do arquivo', () => {
  it('arquivo valido: le o perfil sem problemas', () => {
    const parsed = parseFiscalProfiles(file(approvedProfile()));

    expect(parsed.problems).toEqual([]);
    expect(parsed.perfis).toEqual([approvedProfile()]);
  });

  it.each([
    ['nao e objeto', 'texto'],
    ['lista no topo', []],
    ['versaoEsquema errada', { versaoEsquema: 2, perfis: [] }],
    ['perfis nao e lista', { versaoEsquema: 1, perfis: {} }],
    ['campo desconhecido no topo', { versaoEsquema: 1, perfis: [], extra: 1 }],
  ])('formato invalido (%s): problema e nenhum perfil', (_nome, raw) => {
    const parsed = parseFiscalProfiles(raw);

    expect(parsed.problems.length).toBeGreaterThan(0);
    expect(parsed.perfis).toEqual([]);
  });

  const mutate = (fn: (p: Record<string, unknown>) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(approvedProfile())) as Record<string, unknown>;
    fn(copy);
    return file(copy);
  };

  it.each([
    ['id invalido', (p: Record<string, unknown>) => (p.id = 'ID Maiusculo')],
    ['versao zero', (p: Record<string, unknown>) => (p.versao = 0)],
    ['versao fracionada', (p: Record<string, unknown>) => (p.versao = 1.5)],
    ['descricao vazia', (p: Record<string, unknown>) => (p.descricao = '  ')],
    ['campo desconhecido', (p: Record<string, unknown>) => (p.extra = 1)],
    ['sem servico', (p: Record<string, unknown>) => delete p.servico],
    [
      'cTribNac com 5 digitos',
      (p: Record<string, unknown>) => ((p.servico as Record<string, unknown>).cTribNac = '99010'),
    ],
    [
      'cNBS ausente',
      (p: Record<string, unknown>) => delete (p.servico as Record<string, unknown>).cNBS,
    ],
    [
      'cTribMun com 4 digitos',
      (p: Record<string, unknown>) => ((p.servico as Record<string, unknown>).cTribMun = '7777'),
    ],
    [
      'permitidos vazio',
      (p: Record<string, unknown>) => ((p.permitidos as Record<string, unknown>).tribIssqn = []),
    ],
    [
      'tribIssqn 2 (nao suportado)',
      (p: Record<string, unknown>) => ((p.permitidos as Record<string, unknown>).tribIssqn = [2]),
    ],
    [
      'exigeEndereco nao booleano',
      (p: Record<string, unknown>) =>
        ((p.tomador as Record<string, unknown>).exigeEndereco = 'sim'),
    ],
    ['tribFed ausente (use null)', (p: Record<string, unknown>) => delete p.tribFed],
    [
      'CST PIS/COFINS fora da lista',
      (p: Record<string, unknown>) =>
        ((p.tribFed as Record<string, Record<string, unknown>>).piscofins.cst = '10'),
    ],
    [
      'retencao acima de 100',
      (p: Record<string, unknown>) =>
        ((p.tribFed as Record<string, Record<string, unknown>>).retencoes.irrfPct = '100.01'),
    ],
    [
      'retencao com 3 casas',
      (p: Record<string, unknown>) =>
        ((p.tribFed as Record<string, Record<string, unknown>>).retencoes.irrfPct = '1.505'),
    ],
    [
      'totTrib sem tipo valido',
      (p: Record<string, unknown>) => ((p.totTrib as Record<string, unknown>).tipo = 'outro'),
    ],
    [
      'totTrib sem percentual',
      (p: Record<string, unknown>) => delete (p.totTrib as Record<string, unknown>).est,
    ],
    [
      'indDest 2',
      (p: Record<string, unknown>) => ((p.ibscbs as Record<string, unknown>).indDest = 2),
    ],
    [
      'cIndOp com 5 digitos',
      (p: Record<string, unknown>) => ((p.ibscbs as Record<string, unknown>).cIndOp = '28888'),
    ],
    [
      'CST com 2 digitos',
      (p: Record<string, unknown>) => ((p.ibscbs as Record<string, unknown>).cst = '28'),
    ],
    [
      'cClassTrib com letra',
      (p: Record<string, unknown>) => ((p.ibscbs as Record<string, unknown>).cClassTrib = '28888A'),
    ],
    [
      'tpEnteGov 5',
      (p: Record<string, unknown>) => ((p.ibscbs as Record<string, unknown>).tpEnteGov = 5),
    ],
    [
      'status desconhecido',
      (p: Record<string, unknown>) => ((p.aprovacao as Record<string, unknown>).status = 'ok'),
    ],
    [
      'data de aprovacao invalida',
      (p: Record<string, unknown>) =>
        ((p.aprovacao as Record<string, unknown>).aprovadoEm = '2026-02-30'),
    ],
    [
      'hash com tamanho errado',
      (p: Record<string, unknown>) =>
        ((p.aprovacao as Record<string, unknown>).conteudoSha256 = 'abc'),
    ],
  ])('perfil invalido (%s): fica de fora e gera problema', (_nome, change) => {
    const parsed = parseFiscalProfiles(mutate(change));

    expect(parsed.perfis).toEqual([]);
    expect(parsed.problems.length).toBeGreaterThan(0);
  });

  it('id + versao repetidos: problema (o segundo nao entra)', () => {
    const parsed = parseFiscalProfiles(file(approvedProfile(), approvedProfile()));

    expect(parsed.perfis).toHaveLength(1);
    expect(parsed.problems.join(' ')).toMatch(/repetidos/);
  });

  it('as mensagens citam o campo e o id, nunca o valor informado', () => {
    const parsed = parseFiscalProfiles(
      mutate((p) => {
        (p.servico as Record<string, unknown>).cNBS = 'VALOR-SECRETO-XYZ';
        (p.ibscbs as Record<string, unknown>).cst = 'OUTRO-VALOR-ABC';
      }),
    );

    expect(parsed.problems.join(' ')).toMatch(/cNBS/);
    expect(parsed.problems.join(' ')).not.toMatch(/SECRETO|OUTRO-VALOR/);
  });

  it('textos com quebra de linha ou controle sao recusados', () => {
    for (const texto of [
      'linha1\nlinha2',
      'tab\there',
      `sep${String.fromCharCode(0x2028)}arador`,
    ]) {
      const parsed = parseFiscalProfiles(mutate((p) => (p.descricao = texto)));
      expect(parsed.perfis).toEqual([]);
    }
  });

  it('normalizePercent: 2 casas, 0 a 100, sem texto livre', () => {
    expect(normalizePercent('1')).toBe('1.00');
    expect(normalizePercent('01.50')).toBe('1.50');
    expect(normalizePercent('100')).toBe('100.00');
    expect(normalizePercent('0')).toBe('0.00');
    for (const ruim of ['100.01', '-1', '1,5', '1.234', 'abc', '', 5, null]) {
      expect(normalizePercent(ruim)).toBeNull();
    }
  });
});

describe('NFS-e - perfil fiscal: aprovacao pela contadora', () => {
  it('aprovado, com aprovador, data e hash que conferem: pode ser usado', () => {
    expect(checkProfile(approvedProfile(), SYNTHETIC_TODAY)).toEqual({ usable: true });
  });

  it.each([
    ['rascunho', withApproval({ status: 'rascunho' }), /ainda nao aprovado/],
    ['revogado', withApproval({ status: 'revogado' }), /revogado/],
    ['sem aprovador', withApproval({ aprovadoPor: null }), /incompleta/],
    ['sem data', withApproval({ aprovadoEm: null }), /incompleta/],
    ['sem hash', withApproval({ conteudoSha256: null }), /incompleta/],
    ['aprovado no futuro', withApproval({ aprovadoEm: '2026-12-01' }), /futuro/],
    [
      'hash de outro conteudo',
      withApproval({ conteudoSha256: 'b'.repeat(64) }),
      /alterado depois da aprovacao/,
    ],
  ])('%s: nao pode ser usado', (_nome, profile, motivo) => {
    const result = checkProfile(profile, SYNTHETIC_TODAY);

    expect(result.usable).toBe(false);
    expect(result.usable === false && result.motivo).toMatch(motivo);
  });

  it('alterar qualquer codigo depois da aprovacao invalida o perfil', () => {
    const altered: NfseFiscalProfile = {
      ...approvedProfile(),
      servico: { ...approvedProfile().servico, cNBS: '188888889' },
    };

    expect(checkProfile(altered, SYNTHETIC_TODAY).usable).toBe(false);
  });
});

describe('NFS-e - perfil fiscal: selecao por servico', () => {
  it('escolhe o perfil aprovado do servico', () => {
    expect(selectProfile([approvedProfile()], SYNTHETIC_SERVICE, SYNTHETIC_TODAY)).toEqual({
      ok: true,
      profile: approvedProfile(),
    });
  });

  it('servico sem perfil: recusa', () => {
    expect(selectProfile([approvedProfile()], '990909', SYNTHETIC_TODAY)).toEqual({
      ok: false,
      error: 'servico: nao ha perfil fiscal cadastrado para este codigo',
    });
    expect(selectProfile([], SYNTHETIC_SERVICE, SYNTHETIC_TODAY).ok).toBe(false);
  });

  it('a MAIOR versao do id governa: com a nova em rascunho, a anterior aprovada NAO volta a valer', () => {
    const v2 = {
      ...approvedProfile({ versao: 2 }),
      aprovacao: {
        status: 'rascunho' as const,
        aprovadoPor: null,
        aprovadoEm: null,
        conteudoSha256: null,
      },
    };

    const result = selectProfile([approvedProfile(), v2], SYNTHETIC_SERVICE, SYNTHETIC_TODAY);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/v2.*ainda nao aprovado/);
  });

  it('versao nova aprovada substitui a anterior', () => {
    const v2 = approvedProfile({ versao: 2, descricao: 'versao dois sintetica' });

    const result = selectProfile([approvedProfile(), v2], SYNTHETIC_SERVICE, SYNTHETIC_TODAY);

    expect(result.ok && result.profile.versao).toBe(2);
  });

  it('dois perfis (ids diferentes) para o mesmo servico: ambiguo, recusa', () => {
    const other = approvedProfile({ id: 'outro-sintetico' });

    const result = selectProfile([approvedProfile(), other], SYNTHETIC_SERVICE, SYNTHETIC_TODAY);

    expect(result).toEqual({
      ok: false,
      error: 'servico: mais de um perfil fiscal para este codigo (ambiguo)',
    });
  });

  it('perfil revogado ou alterado: recusa com o motivo, sem o conteudo', () => {
    const result = selectProfile(
      [withApproval({ status: 'revogado' })],
      SYNTHETIC_SERVICE,
      SYNTHETIC_TODAY,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(
      'servico: perfil fiscal servico-sintetico v1: perfil revogado',
    );
  });
});

describe('NFS-e - perfil fiscal: calculo exato dos valores', () => {
  it.each([
    ['1500.50', '1.50', '22.51'],
    ['1500.50', '2.00', '30.01'],
    ['0.01', '50.00', '0.01'],
    ['0.01', '49.00', '0.00'],
    ['100.00', '0.00', '0.00'],
    ['100.00', '100.00', '100.00'],
    ['999999999999.99', '13.45', '134500000000.00'],
    ['10.00', '0.05', '0.01'],
  ])('%s x %s%% = %s (meio para cima, sem ponto flutuante)', (valor, pct, esperado) => {
    expect(applyPercent(valor, pct)).toBe(esperado);
  });

  it('o resultado respeita o formato do esquema (zero e 0.NN; inteiros sem zero a esquerda)', () => {
    for (const valor of ['0.00', '0.50', '7.00', '123456.78']) {
      expect(applyPercent('100000.00', '0.00')).toMatch(/^0\.00$/);
      expect(valor).toMatch(/^(0|0\.[0-9]{2}|[1-9][0-9]{0,14}(\.[0-9]{2})?)$/);
    }
  });

  it('instantaneo: retencoes e totais calculados do valor, perfil gravado com id, versao e hash', () => {
    const result = buildFiscalSnapshot(approvedProfile(), {
      valor: '1500.50',
      tribIssqn: 1,
      tpRetIssqn: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.snapshot.perfil).toEqual({
      id: 'servico-sintetico',
      versao: 1,
      conteudoSha256: approvedProfile().aprovacao.conteudoSha256,
      aprovadoPor: 'Contadora Ficticia',
      aprovadoEm: '2026-10-01',
    });
    expect(result.snapshot.tribFed).toMatchObject({
      vRetIRRF: '22.51',
      vRetCSLL: '30.01',
      vRetCP: null,
    });
    expect(result.snapshot.totTrib).toEqual({
      tipo: 'valores',
      fed: '150.05',
      est: '75.03',
      mun: '37.51',
    });
  });

  it('totais em percentual e indicador sao repassados como estao', () => {
    const pct = buildFiscalSnapshot(
      approvedProfile({ totTrib: { tipo: 'percentuais', fed: '13.45', est: '0.00', mun: '2.50' } }),
      { valor: '1500.50', tribIssqn: 1, tpRetIssqn: 1 },
    );
    expect(pct.ok && pct.snapshot.totTrib).toEqual({
      tipo: 'percentuais',
      fed: '13.45',
      est: '0.00',
      mun: '2.50',
    });
    const ind = buildFiscalSnapshot(approvedProfile({ totTrib: { tipo: 'indicador' } }), {
      valor: '1500.50',
      tribIssqn: 1,
      tpRetIssqn: 1,
    });
    expect(ind.ok && ind.snapshot.totTrib).toEqual({ tipo: 'indicador' });
  });

  it('iss/ret fora do permitido pelo perfil: erro citando so o campo', () => {
    expect(
      buildFiscalSnapshot(approvedProfile(), { valor: '10.00', tribIssqn: 4, tpRetIssqn: 1 }),
    ).toEqual({
      ok: false,
      errors: ['iss: valor nao permitido pelo perfil fiscal'],
    });
    expect(
      buildFiscalSnapshot(approvedProfile(), { valor: '10.00', tribIssqn: 1, tpRetIssqn: 3 }),
    ).toEqual({
      ok: false,
      errors: ['ret: valor nao permitido pelo perfil fiscal'],
    });
  });

  it('sem tributos federais no perfil: o instantaneo nao traz tribFed', () => {
    const result = buildFiscalSnapshot(approvedProfile({ tribFed: null }), {
      valor: '10.00',
      tribIssqn: 1,
      tpRetIssqn: 1,
    });

    expect(result.ok && result.snapshot.tribFed).toBeNull();
  });
});

describe('NFS-e - perfil fiscal: arquivo no disco', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vastaflow-perfis-'));
  const write = (name: string, content: string): string => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  it('le um arquivo valido', () => {
    const path = write('ok.json', JSON.stringify(file(approvedProfile())));

    const parsed = loadFiscalProfiles(path);

    expect(parsed.problems).toEqual([]);
    expect(parsed.perfis).toHaveLength(1);
  });

  it.each([
    ['inexistente', join(dir, 'nao-existe.json'), /ilegivel/],
    ['JSON quebrado', write('quebrado.json', '{ "versaoEsquema": 1, '), /ilegivel/],
    [
      'grande demais',
      write('grande.json', 'x'.repeat(PROFILES_FILE_MAX_BYTES + 1)),
      /grande demais/,
    ],
  ])('%s: problema fixo, sem repetir caminho nem conteudo', (_nome, path, motivo) => {
    const parsed = loadFiscalProfiles(path);

    expect(parsed.perfis).toEqual([]);
    expect(parsed.problems.join(' ')).toMatch(motivo);
    expect(parsed.problems.join(' ')).not.toContain(dir);
  });
});
