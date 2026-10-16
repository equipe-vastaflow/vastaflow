import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regras ESTATICAS da preparacao de implantacao (HTTPS, backup, restauracao). Complementam os testes
 * de execucao reais (`infra/https/test-https.sh` e `scripts/restore-test.sh`, que precisam de Docker):
 * estes rodam em qualquer maquina e impedem que uma edicao futura reabra uma porta, ponha uma senha em
 * argumento de comando ou troque a cifra por uma que o servidor consiga abrir.
 */
const ROOT = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const semComentarios = (texto: string): string =>
  texto
    .split(/\r?\n/)
    .filter((linha) => !/^\s*#/.test(linha))
    .join('\n');

/** Valores de `ports:` por servico (YAML simples do Compose: bloco `ports:` seguido de itens `- ...`). */
function portasPorServico(yaml: string): Record<string, string[]> {
  const resultado: Record<string, string[]> = {};
  let servico = '';
  let emPortas = false;
  for (const linha of semComentarios(yaml).split(/\r?\n/)) {
    const novo = /^ {2}([a-z0-9-]+):\s*$/.exec(linha);
    if (novo !== null) {
      servico = novo[1] ?? '';
      emPortas = false;
      continue;
    }
    if (/^\s{4}ports:/.test(linha)) {
      emPortas = true;
      continue;
    }
    const item = /^\s{6}-\s*['"]?([^'"]+)['"]?\s*$/.exec(linha);
    if (emPortas && item !== null) {
      (resultado[servico] ??= []).push(item[1] ?? '');
    } else if (emPortas && !/^\s*$/.test(linha)) {
      emPortas = false;
    }
  }
  return resultado;
}

describe('Implantacao - superficie de rede', () => {
  it('Compose de producao: so o nginx e o editor do n8n (apenas em 127.0.0.1) publicam porta', () => {
    const portas = portasPorServico(read('docker-compose.production.yml'));
    expect(Object.keys(portas).sort()).toEqual(['n8n', 'nginx']);
    expect(portas.n8n).toEqual(['127.0.0.1:${N8N_EDITOR_PORT:-5678}:5678']);
    for (const mapeamento of portas.nginx ?? []) {
      expect(mapeamento).toMatch(/:80$/);
    }
  });

  it('sobreposicao HTTPS: publica exatamente 80 e 443 no nginx e mais nada', () => {
    const yaml = read('docker-compose.https.yml');
    expect(yaml).toContain('ports: !override');
    const portas = portasPorServico(yaml.replace('ports: !override', 'ports:'));
    expect(portas).toEqual({ nginx: ['80:80', '443:443'] });
  });

  it('o ingress HTTPS nao conhece n8n, MySQL nem PostgreSQL', () => {
    const efetivo =
      semComentarios(read('infra/https/vastaflow-https.conf.template')) +
      semComentarios(read('frontend/nginx/snippets/vastaflow-app.conf'));
    expect(efetivo).not.toMatch(/5678|3306|5432|n8n|mysql|postgres/i);
  });

  it('HTTPS: TLS 1.2+, redirecionamento, desafio ACME e dominio por variavel (nunca fixo)', () => {
    const modelo = semComentarios(read('infra/https/vastaflow-https.conf.template'));
    expect(modelo).toContain('ssl_protocols TLSv1.2 TLSv1.3');
    expect(modelo).toContain('return 301 https://$host$request_uri');
    expect(modelo).toContain('/.well-known/acme-challenge/');
    expect(modelo).toContain('ssl_session_tickets off');
    expect(modelo.match(/\$\{SERVER_NAME\}/g)?.length).toBeGreaterThanOrEqual(4);
    expect(modelo).not.toMatch(/server_name\s+(?!\$\{SERVER_NAME\}|_)[a-z0-9.-]+\./i);
  });

  it('o corpo do ingress e UM so, compartilhado por HTTP e HTTPS, e mantem os bloqueios', () => {
    expect(semComentarios(read('frontend/nginx/conf.d/vastaflow.conf'))).toContain(
      'include /etc/nginx/snippets/vastaflow-app.conf',
    );
    expect(read('infra/https/vastaflow-https.conf.template')).toContain(
      'include /etc/nginx/snippets/vastaflow-app.conf',
    );
    const corpo = semComentarios(read('frontend/nginx/snippets/vastaflow-app.conf'));
    expect(corpo).toMatch(/location = \/api\/webhooks\/whatsapp/);
    expect(corpo).toMatch(/location ~\* \^\/api\/service \{\s*return 404;/);
    expect(corpo).toMatch(/location = \/api\/health\/readiness \{\s*deny all;/);
    expect(corpo).toContain('client_max_body_size 256k');
    expect(corpo).toContain('vastaflow_webhook');
  });

  it('HSTS so sai em HTTPS (mapa por esquema) e comeca curto', () => {
    expect(read('frontend/nginx/snippets/seguranca.conf')).toContain(
      'Strict-Transport-Security $vastaflow_hsts',
    );
    const mapa = semComentarios(read('frontend/nginx/conf.d/02-hsts.conf'));
    expect(mapa).toMatch(/default\s+"";/);
    expect(mapa).toMatch(/https\s+"max-age=86400";/);
  });

  it('o certbot nao ganha porta e o certificado fica em volume, nao em arquivo do repositorio', () => {
    const yaml = read('docker-compose.https.yml');
    expect(yaml).toContain('vastaflow-letsencrypt');
    expect(yaml).not.toMatch(/\.pem|privkey/);
  });
});

describe('Implantacao - backup e restauracao', () => {
  const backup = semComentarios(read('scripts/backup.sh'));
  const restore = semComentarios(read('scripts/restore.sh'));

  it('cifra com chave PUBLICA: nunca simetrica, e cada fonte vai direto ao gpg (sem texto em claro em disco)', () => {
    expect(backup).toContain('--encrypt');
    expect(backup).toContain('--recipient');
    expect(backup).not.toMatch(/--symmetric|--passphrase|-c\b.*gpg/);
    // Todo redirecionamento para arquivo do backup e do manifesto/avisos; dumps passam por encrypt_to.
    const redirecionamentos = [...backup.matchAll(/>\s*"\$WORK\/(\S+)/g)].map((m) => m[1]);
    for (const alvo of redirecionamentos) {
      expect(alvo).toMatch(/MANIFESTO\.txt|SHA256SUMS|AUSENTE/);
    }
    for (const arquivo of [
      'mysql.sql.gz.gpg',
      'n8n-postgres.pgdump.gpg',
      'documents.tar.gz.gpg',
      'n8n-state.tar.gz.gpg',
      'config.tar.gz.gpg',
    ]) {
      expect(backup).toContain(arquivo);
    }
    expect(backup).toContain('| encrypt_to');
  });

  it('dumps consistentes, com falha propagada (pipefail) e saida vazia recusada', () => {
    expect(backup).toContain('set -euo pipefail');
    expect(backup).toContain('--single-transaction');
    expect(backup).toContain('--format=custom');
    expect(backup).toContain('require_nonempty');
  });

  it('nenhuma senha em argumento de linha de comando', () => {
    for (const script of [backup, restore]) {
      expect(script).not.toMatch(/--password|--passphrase|mysql(dump)?\b[^\n|]*\s-p\S/);
      for (const atribuicao of script.matchAll(/(MYSQL_PWD|PGPASSWORD)=("[^"]*"|\S+)/g)) {
        expect(atribuicao[2]).toMatch(/^"\$(MYSQL_ROOT_PASSWORD|POSTGRES_PASSWORD)"$/);
      }
    }
  });

  it('o servidor nao precisa da chave privada: o backup usa so --encrypt, e o restore e quem decifra', () => {
    expect(backup).not.toContain('--decrypt');
    expect(restore).toContain('--decrypt');
  });

  it('retencao local preserva um minimo e a copia externa e verificada', () => {
    expect(backup).toContain('BACKUP_KEEP_MIN');
    expect(backup).toContain('rclone check');
    expect(backup).toContain('--checksum');
  });

  it('restore: integridade, alvo confirmado, producao protegida, alvo vazio e configuracao nunca por cima', () => {
    expect(restore).toContain('sha256sum -c SHA256SUMS');
    expect(restore).toContain('VF_RESTORE_CONFIRM');
    expect(restore).toContain('restaurar-em-');
    expect(restore).toContain('SOBRESCREVER-PRODUCAO');
    expect(restore).toContain('VF_RESTORE_FORCE');
    expect(restore).toMatch(/information_schema\.tables/);
    expect(restore).toMatch(/CONFIG_OUT[\s\S]*ja existe/);
    // A ordem importa: confirmar o alvo ANTES de qualquer escrita.
    expect(restore.indexOf('VF_RESTORE_CONFIRM:-}" != "restaurar-em-')).toBeLessThan(
      restore.indexOf("mysql -uroot'"),
    );
    expect(restore.indexOf('sha256sum -c')).toBeLessThan(
      restore.indexOf('VF_RESTORE_CONFIRM:-}" != "restaurar-em-'),
    );
  });

  it('o teste de restauracao so opera projetos descartaveis (vf-rt-*) e nunca o Compose de producao', () => {
    const teste = read('scripts/restore-test.sh');
    expect(teste).toContain('case "$project" in vf-rt-*)');
    expect(teste).not.toMatch(/-f docker-compose\.production\.yml[^'"]*down/);
    expect(read('infra/restore-test/compose.yml')).not.toMatch(/^\s+ports:/m);
    // Volumes do teste nao tem nome fixo (o Compose os prefixa com o projeto), exceto o TLS ficticio.
    const volumes = read('infra/restore-test/compose.yml').split(/^volumes:/m)[1] ?? '';
    expect(volumes.match(/name:\s*\S+/g)).toEqual(['name: vf-restore-test-tls']);
  });

  it('o agendador usa Persistent=true e o modelo de configuracao nao traz valor sensivel', () => {
    expect(read('infra/backup/vastaflow-backup.timer')).toContain('Persistent=true');
    const modelo = semComentarios(read('infra/backup/backup.env.example'));
    for (const chave of ['BACKUP_GPG_RECIPIENT', 'BACKUP_REMOTE']) {
      expect(modelo).toMatch(new RegExp(`^${chave}=$`, 'm'));
    }
  });

  it('o .gitignore cobre .env, chaves, backups e arquivos cifrados', () => {
    const ignorados = read('.gitignore');
    for (const padrao of [
      '.env',
      '*.pem',
      '*.key',
      '*.pfx',
      'backups/',
      '*.gpg',
      '*.asc',
      '*.pgdump',
    ]) {
      expect(ignorados.split(/\r?\n/)).toContain(padrao);
    }
  });

  it('os scripts existem e comecam com shebang bash', () => {
    for (const script of ['backup.sh', 'restore.sh', 'restore-test.sh', 'https-init.sh']) {
      const caminho = join(ROOT, 'scripts', script);
      expect(existsSync(caminho)).toBe(true);
      expect(readFileSync(caminho, 'utf8').startsWith('#!/usr/bin/env bash\n')).toBe(true);
    }
  });
});
