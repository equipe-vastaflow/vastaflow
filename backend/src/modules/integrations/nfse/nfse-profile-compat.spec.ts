import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  approvedProfile,
  SYNTHETIC_TODAY,
  syntheticDraft,
} from '../../../../test/support/nfse-profile-fixtures';
import {
  checkProfile,
  profileContentHash,
  selectProfile,
  type NfseFiscalProfile,
} from './nfse-fiscal-profile';
import { checkProfileCompatibility, describeIssues } from './nfse-profile-compat';
import { ANEXO_B_NBS } from './tabelas/anexo-b-nbs';
import { ANEXO_B_SERVICOS } from './tabelas/anexo-b-servicos';
import { ANEXO_C_INDOP } from './tabelas/anexo-c-indop';

/**
 * Compatibilidade perfil fiscal x gerador de DPS. Perfis SINTETICOS: os codigos usados sao apenas codigos que EXISTEM
 * nas tabelas oficiais (para exercitar as regras), sem nenhum significado fiscal e sem relacao com uma nota real.
 */
type Draft = Omit<NfseFiscalProfile, 'aprovacao'>;
const regras = (draft: Draft): string[] => checkProfileCompatibility(draft).map((i) => i.regra);
const draft = (over: Partial<Draft> = {}): Draft => syntheticDraft(over);
const ibscbs = (over: Partial<Draft['ibscbs']>): Draft['ibscbs'] => ({
  ...syntheticDraft().ibscbs,
  ...over,
});
const servico = (cTribNac: string, cNBS = syntheticDraft().servico.cNBS): Draft['servico'] => ({
  cTribNac,
  cTribMun: null,
  cNBS,
});
const SEM_ENDERECO = {
  tomador: { exigeEndereco: false },
  permitidos: { tribIssqn: [1 as const], tpRetIssqn: [1 as const] },
};

describe('NFS-e - tabelas oficiais embutidas (Anexos B e C)', () => {
  it('tamanho e formato: 6 digitos (cTribNac), 9 digitos (cNBS) e 6 digitos (cIndOp)', () => {
    expect(ANEXO_B_SERVICOS.size).toBe(338);
    expect(ANEXO_B_NBS.size).toBe(918);
    expect(Object.keys(ANEXO_C_INDOP)).toHaveLength(26);
    for (const codigo of ANEXO_B_SERVICOS) {
      expect(codigo).toMatch(/^\d{6}$/);
    }
    for (const codigo of ANEXO_B_NBS) {
      expect(codigo).toMatch(/^\d{9}$/);
    }
    for (const codigo of Object.keys(ANEXO_C_INDOP)) {
      expect(codigo).toMatch(/^\d{6}$/);
    }
  });

  it('proveniencia: cada arquivo cita a fonte oficial e o SHA-256 do .xlsx de origem (o mesmo do Anexo B nos dois)', () => {
    const ler = (nome: string): string => readFileSync(join(__dirname, 'tabelas', nome), 'utf8');
    const sha = (texto: string): string =>
      /SHA-256 do \.xlsx de producao restrita: ([0-9a-f]{64})/.exec(texto)?.[1] ?? '';

    const [servicos, nbs, indop] = [
      'anexo-b-servicos.ts',
      'anexo-b-nbs.ts',
      'anexo-c-indop.ts',
    ].map(ler);

    expect(sha(servicos ?? '')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(servicos ?? '')).toBe(sha(nbs ?? ''));
    expect(sha(indop ?? '')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(indop ?? '')).not.toBe(sha(servicos ?? ''));
    for (const texto of [servicos, nbs, indop]) {
      expect(texto).toMatch(/DADOS OFICIAIS/);
      expect(texto).toMatch(/gov\.br\/nfse/);
    }
  });

  it('a classe de cada cIndOp bate com a coluna "Campo no leiaute" do Anexo C (derivacao conferida codigo a codigo)', () => {
    const esperado: Record<string, string> = {
      '020101': 'imovel',
      '020201': 'imovel',
      '020301': 'imovel',
      '030101': 'estabelecimento-prestador',
      '030102': 'adquirente-ou-destinatario',
      '030103': 'destinatario',
      '030104': 'local-da-prestacao',
      '040101': 'evento',
      '050101': 'estabelecimento-prestador',
      '050102': 'adquirente-ou-destinatario',
      '050103': 'destinatario',
      '050104': 'local-da-prestacao',
      '050201': 'local-da-prestacao',
      '060101': 'local-da-prestacao',
      '070101': 'local-da-prestacao',
      '070102': 'local-da-prestacao',
      '080101': 'via',
      '100101': 'adquirente-ou-destinatario',
      '100102': 'exterior',
      '100201': 'adquirente-ou-destinatario',
      '100301': 'adquirente-ou-destinatario',
      '100302': 'exterior',
      '100401': 'adquirente-ou-destinatario',
      '100501': 'adquirente-ou-destinatario',
      '100502': 'exterior',
      '100601': 'adquirente-ou-destinatario',
    };

    expect(
      Object.fromEntries(Object.entries(ANEXO_C_INDOP).map(([k, v]) => [k, v.classe])),
    ).toEqual(esperado);
  });
});

describe('NFS-e - compatibilidade: perfil VALIDO', () => {
  it('o perfil sintetico padrao e compativel (e o hash da aprovacao nao muda por isso)', () => {
    expect(checkProfileCompatibility(syntheticDraft())).toEqual([]);
    expect(checkProfile(approvedProfile(), SYNTHETIC_TODAY)).toEqual({ usable: true });
  });

  it.each(
    Object.entries(ANEXO_C_INDOP)
      .filter(([, v]) => v.classe === 'local-da-prestacao')
      .map(([codigo]) => [codigo]),
  )(
    'cIndOp %s (local da prestacao): vale SEM endereco do tomador e sem retencao do ISS pelo tomador',
    (cIndOp) => {
      expect(regras(draft({ ...SEM_ENDERECO, ibscbs: ibscbs({ cIndOp }) }))).toEqual([]);
    },
  );

  it.each(
    Object.entries(ANEXO_C_INDOP)
      .filter(([, v]) => v.classe === 'adquirente-ou-destinatario')
      .map(([codigo]) => [codigo]),
  )('cIndOp %s (endereco do adquirente) com indDest=0: vale COM endereco exigido', (cIndOp) => {
    expect(regras(draft({ ibscbs: ibscbs({ cIndOp }) }))).toEqual([]);
  });

  it('operacao com imovel em subitem de construcao civil: o grupo imovel nem e permitido, entao vale', () => {
    for (const subitem of ['070201', '070401', '071901']) {
      expect(
        regras(
          draft({
            servico: servico(subitem),
            ibscbs: ibscbs({ cIndOp: '020101' }),
            ...SEM_ENDERECO,
          }),
        ),
      ).toEqual([]);
    }
  });

  it.each([
    ['sem tpEnteGov nem tpOper', null, null, '010301'],
    ['compra governamental com tpOper 1', 4, 1, '010301'],
    ['compra governamental com tpOper 4', 2, 4, '010301'],
    ['compra governamental com tpOper 5', 1, 5, '010301'],
    ['servico 10.05 com tpOper 1 (sem tpEnteGov)', null, 1, '100501'],
    ['servico 25.05 com tpOper 5', null, 5, '250501'],
  ])('tpOper/tpEnteGov: %s', (_nome, tpEnteGov, tpOper, cTribNac) => {
    const result = regras(
      draft({
        servico: servico(cTribNac),
        ibscbs: ibscbs({
          tpEnteGov: tpEnteGov as Draft['ibscbs']['tpEnteGov'],
          tpOper: tpOper as Draft['ibscbs']['tpOper'],
        }),
      }),
    );

    expect(result.filter((r) => r.startsWith('OPER') || r === 'REF-1')).toEqual([]);
  });

  it('PIS/COFINS/CSLL: retido exige a retencao; nao retido (0) a proibe; "2" aceita ambas', () => {
    const com = (tpRetPisCofins: string | null, csllPct: string | null): Draft['tribFed'] => ({
      piscofins: { cst: '99', tpRetPisCofins },
      retencoes: { cpPct: null, irrfPct: null, csllPct },
    });

    expect(regras(draft({ tribFed: com('3', '1.00') }))).toEqual([]);
    expect(regras(draft({ tribFed: com('0', null) }))).toEqual([]);
    expect(regras(draft({ tribFed: com('2', null) }))).toEqual([]);
    expect(regras(draft({ tribFed: com('2', '1.00') }))).toEqual([]);
    expect(regras(draft({ tribFed: null }))).toEqual([]);
  });
});

describe('NFS-e - compatibilidade: perfil que o gerador NAO consegue atender e rejeitado', () => {
  it('TAB-1: cTribNac fora da lista de servico nacional (Anexo B)', () => {
    expect(regras(draft({ servico: servico('019999') }))).toContain('TAB-1');
    expect(regras(draft({ servico: servico('000000') }))).toContain('TAB-1');
  });

  it('TAB-2: cNBS fora da tabela NBS 2.0 (Anexo B)', () => {
    expect(regras(draft({ servico: servico('010301', '123456789') }))).toContain('TAB-2');
  });

  it('TAB-3: cIndOp fora da tabela do Anexo C', () => {
    for (const cIndOp of ['000000', '288888', '100301'.replace('3', '9')]) {
      expect(regras(draft({ ibscbs: ibscbs({ cIndOp }) }))).toContain('TAB-3');
    }
  });

  it('SRV-1: 99.03.xx e 99.04.01 (locacao/cessao de bens) sao recusados', () => {
    expect(regras(draft({ servico: servico('990301') }))).toContain('SRV-1');
    expect(regras(draft({ servico: servico('990401') }))).toContain('SRV-1');
  });

  it.each([
    ['030101', 'prest/end'],
    ['050101', 'prest/end'],
    ['030103', 'dest'],
    ['050103', 'dest'],
    ['100102', 'endExt'],
    ['100302', 'endExt'],
    ['100502', 'endExt'],
    ['040101', 'atvEvento'],
    ['080101', 'NFS-e Via'],
  ])('OP-1: cIndOp %s depende de recurso que o VastaFlow nao gera (%s)', (cIndOp, recurso) => {
    const issues = checkProfileCompatibility(draft({ ibscbs: ibscbs({ cIndOp }) }));

    expect(issues.map((i) => i.regra)).toContain('OP-1');
    expect(issues.find((i) => i.regra === 'OP-1')?.mensagem).toContain(recurso);
  });

  it.each(['020101', '020201', '020301'])(
    'OP-2: cIndOp %s (imovel) exige o grupo imovel quando o servico nao e de construcao civil',
    (cIndOp) => {
      expect(regras(draft({ ibscbs: ibscbs({ cIndOp }), ...SEM_ENDERECO }))).toContain('OP-2');
    },
  );

  it('DEST-1: indDest=1 exige o grupo dest', () => {
    expect(regras(draft({ ibscbs: ibscbs({ indDest: 1 }) }))).toContain('DEST-1');
  });

  it.each([2, 3] as const)('REF-1: tpOper=%s exige gRefNFSe', (tpOper) => {
    expect(regras(draft({ ibscbs: ibscbs({ tpOper, tpEnteGov: 4 }) }))).toContain('REF-1');
  });

  it('OPER-1: tpEnteGov sem tpOper; servico 25.05, 15.09, 17.12 ou 10.05 sem tpOper', () => {
    expect(regras(draft({ ibscbs: ibscbs({ tpEnteGov: 4, tpOper: null }) }))).toContain('OPER-1');
    for (const cTribNac of ['250501', '150901', '171201', '100501', '100502']) {
      expect(
        regras(draft({ servico: servico(cTribNac), ibscbs: ibscbs({ tpOper: null }) })),
      ).toContain('OPER-1');
    }
  });

  it('OPER-2: tpOper informado fora de compra governamental e dos servicos listados', () => {
    expect(regras(draft({ ibscbs: ibscbs({ tpEnteGov: null, tpOper: 1 }) }))).toContain('OPER-2');
  });

  it('END-1: local = endereco do adquirente com indDest=0 e exigeEndereco=false', () => {
    expect(
      regras(
        draft({
          tomador: { exigeEndereco: false },
          permitidos: { tribIssqn: [1], tpRetIssqn: [1] },
        }),
      ),
    ).toContain('END-1');
  });

  it('END-2: retencao do ISS pelo tomador (tpRetIssqn inclui 2) exige o endereco do tomador, qualquer que seja o cIndOp', () => {
    const r = regras(
      draft({
        tomador: { exigeEndereco: false },
        permitidos: { tribIssqn: [1], tpRetIssqn: [1, 2] },
        ibscbs: ibscbs({ cIndOp: '030104' }),
      }),
    );

    expect(r).toEqual(['END-2']);
  });

  it('PC-1/PC-2: retencao de CSLL incoerente com tpRetPisCofins', () => {
    const tribFed = (tpRetPisCofins: string, csllPct: string | null): Draft['tribFed'] => ({
      piscofins: { cst: '99', tpRetPisCofins },
      retencoes: { cpPct: null, irrfPct: null, csllPct },
    });

    for (const tp of ['1', '3', '4', '5', '6', '7', '8', '9']) {
      expect(regras(draft({ tribFed: tribFed(tp, null) }))).toContain('PC-1');
    }
    expect(regras(draft({ tribFed: tribFed('0', '2.00') }))).toContain('PC-2');
  });

  it('varias regras de uma vez: todas sao listadas (a pessoa corrige tudo numa passada)', () => {
    const r = regras(
      draft({
        servico: servico('019999', '123456789'),
        ibscbs: ibscbs({ cIndOp: '030101', indDest: 1, tpOper: 2, tpEnteGov: 4 }),
      }),
    );

    expect(r).toEqual(expect.arrayContaining(['TAB-1', 'TAB-2', 'OP-1', 'DEST-1', 'REF-1']));
  });

  it('as mensagens citam o campo e a regra, nunca o valor configurado', () => {
    const issues = checkProfileCompatibility(
      draft({ servico: servico('019999', '123456789'), ibscbs: ibscbs({ cIndOp: '000001' }) }),
    );
    const texto = JSON.stringify(issues);

    expect(texto).not.toMatch(/019999|123456789|000001/);
    expect(describeIssues(issues)).toMatch(/TAB-1/);
  });

  it('describeIssues: mostra ate 3 regras e conta as demais', () => {
    const issues = Array.from({ length: 5 }, (_v, i) => ({
      regra: `R${String(i)}`,
      campo: 'c',
      mensagem: 'm',
    }));

    expect(describeIssues(issues)).toBe('R0: m; R1: m; R2: m; (+2)');
  });
});

describe('NFS-e - compatibilidade integrada a aprovacao e a selecao', () => {
  const incompativel = (): NfseFiscalProfile => approvedProfile({ ibscbs: ibscbs({ indDest: 1 }) });

  it('perfil APROVADO e INTEGRO, mas incompativel: nao pode ser usado (a aprovacao nao basta)', () => {
    const profile = incompativel();
    expect(profile.aprovacao.conteudoSha256).toBe(profileContentHash(profile));

    const result = checkProfile(profile, SYNTHETIC_TODAY);

    expect(result.usable).toBe(false);
    expect(!result.usable && result.motivo).toMatch(/incompativel com o gerador de DPS \(DEST-1:/);
  });

  it('a recusa por aprovacao continua vindo ANTES: rascunho incompativel diz "nao aprovado"', () => {
    const base = incompativel();
    const rascunho = { ...base, aprovacao: { ...base.aprovacao, status: 'rascunho' as const } };

    const result = checkProfile(rascunho, SYNTHETIC_TODAY);

    expect(!result.usable && result.motivo).toMatch(/ainda nao aprovado/);
  });

  it('selectProfile recusa o servico e explica, sem expor valores', () => {
    const result = selectProfile([incompativel()], '010301', SYNTHETIC_TODAY);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(
      /servico: perfil fiscal servico-sintetico v1: incompativel com o gerador de DPS/,
    );
  });

  it('versao nova compativel e aprovada substitui a incompativel (a maior versao governa)', () => {
    const v1 = incompativel();
    const v2 = approvedProfile({ versao: 2 });

    const result = selectProfile([v1, v2], '010301', SYNTHETIC_TODAY);

    expect(result.ok && result.profile.versao).toBe(2);
  });

  it('PENDENCIAS NAO verificadas (documentadas): CST e cClassTrib so tem o formato conferido', () => {
    // Nao ha tabela oficial disponivel nos anexos; a conferencia e da Calculadora do IBS/CBS (so na API oficial).
    for (const [cst, cClassTrib] of [
      ['000', '000001'],
      ['999', '999999'],
      ['123', '654321'],
    ]) {
      expect(regras(draft({ ibscbs: ibscbs({ cst, cClassTrib }) }))).toEqual([]);
    }
  });
});
