import { readFileSync } from 'node:fs';
import { todayInBrasilia } from './nfse-dps';
import {
  canonicalJson,
  checkProfile,
  parseFiscalProfiles,
  profileContentHash,
} from './nfse-fiscal-profile';
import { checkProfileCompatibility } from './nfse-profile-compat';

/**
 * Apoio a aprovacao dos perfis fiscais (so leitura; nao altera o arquivo, nao fala com a rede):
 *
 *   node dist/modules/integrations/nfse/nfse-fiscal-profile.cli.js check <arquivo>
 *   node dist/modules/integrations/nfse/nfse-fiscal-profile.cli.js show <arquivo> <id> <versao>
 *
 * - `check`: valida o arquivo e diz, para cada perfil, se esta aprovado e utilizavel e qual e o hash do
 *   conteudo que a aprovacao precisa registrar (`aprovacao.conteudoSha256`);
 * - `show`: imprime o conteudo canonico de UM perfil (sem o bloco de aprovacao) e o seu hash: e a "folha" que a
 *   contadora revisa e aprova. Quem aprova registra o hash no arquivo; qualquer mudanca de conteudo depois disso
 *   invalida a aprovacao.
 *
 * Saida so com campos e codigos do PROPRIO perfil; nunca segredo (o arquivo nao tem).
 */
export interface ProfileCliIo {
  readonly read: (path: string) => string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** Hoje (AAAA-MM-DD, Brasilia). */
  readonly today: () => string;
}

const USAGE = 'uso: check <arquivo> | show <arquivo> <id> <versao>';

/** Codigo de saida: 0 ok, 1 arquivo com problema ou perfil nao utilizavel, 2 uso. */
export function run(argv: readonly string[], io: ProfileCliIo): number {
  const [command, path, id, versao] = argv;
  if ((command !== 'check' && command !== 'show') || path === undefined) {
    io.err(USAGE);
    return 2;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(io.read(path)) as unknown;
  } catch {
    io.err('erro: arquivo ilegivel ou JSON invalido');
    return 1;
  }
  const parsed = parseFiscalProfiles(raw);
  for (const problem of parsed.problems) {
    io.err(`problema: ${problem}`);
  }

  if (command === 'show') {
    const profile = parsed.perfis.find((p) => p.id === id && String(p.versao) === versao);
    if (id === undefined || versao === undefined) {
      io.err(USAGE);
      return 2;
    }
    if (profile === undefined) {
      io.err('erro: perfil nao encontrado (ou invalido)');
      return 1;
    }
    // Perfil que o gerador de DPS nao consegue atender NAO ganha folha de aprovacao: seria aprovar o que nao emite.
    const issues = checkProfileCompatibility(profile);
    if (issues.length > 0) {
      for (const issue of issues) {
        io.err(`incompativel [${issue.regra}] ${issue.mensagem}`);
      }
      io.err('erro: corrija o perfil antes de aprova-lo (nenhum hash foi gerado)');
      return 1;
    }
    const { aprovacao: _approval, ...content } = profile;
    io.out(canonicalJson(content));
    io.out(`conteudoSha256: ${profileContentHash(profile)}`);
    return parsed.problems.length === 0 ? 0 : 1;
  }

  let usable = true;
  for (const profile of parsed.perfis) {
    const check = checkProfile(profile, io.today());
    usable &&= check.usable;
    io.out(
      `${profile.id} v${String(profile.versao)} | ${profile.aprovacao.status} | ${
        check.usable ? 'UTILIZAVEL' : `NAO utilizavel (${check.motivo})`
      } | conteudoSha256: ${profileContentHash(profile)}`,
    );
    // As incompatibilidades aparecem para TODO perfil, inclusive rascunho: corrigir antes de pedir a aprovacao.
    for (const issue of checkProfileCompatibility(profile)) {
      io.out(`  incompativel [${issue.regra}] ${issue.mensagem}`);
      usable = false;
    }
  }
  if (parsed.perfis.length === 0) {
    io.out('nenhum perfil valido no arquivo');
  }
  return parsed.problems.length === 0 && usable ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2), {
    read: (path) => readFileSync(path, 'utf8'),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    today: () => todayInBrasilia(new Date()),
  });
}
