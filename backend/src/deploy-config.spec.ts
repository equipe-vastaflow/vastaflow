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

  it('o command do nginx HTTPS passa pelo entrypoint COM "nginx" como primeiro argumento (senao o envsubst nao roda)', () => {
    const yaml = semComentarios(read('docker-compose.https.yml'));
    // O /docker-entrypoint.sh da imagem so renderiza os modelos quando $1 e `nginx`/`nginx-debug`.
    expect(yaml).toContain('exec /docker-entrypoint.sh nginx -g');
    expect(yaml).not.toMatch(/exec nginx -g/);
    expect(yaml).toContain('nginx -s reload');
    // O https-init recusa pedir o certificado se o nginx nao serve a :80 (nao gasta tentativas do Let's Encrypt).
    const init = semComentarios(read('scripts/https-init.sh'));
    expect(init.indexOf('nginx-health')).toBeGreaterThan(0);
    expect(init.indexOf('nginx-health')).toBeLessThan(init.indexOf('certonly'));
    expect(init).toContain('NAO vou pedir o certificado');
    // O teste de regressao com o Compose real existe e traz o controle negativo do comando antigo.
    const teste = read('infra/https/test-compose-boot.sh');
    expect(teste).toContain('docker-compose.https.yml');
    expect(teste).toContain('CONTROLE NEGATIVO');
    expect(teste).toContain('10-https.conf');
    expect(read('infra/https/test-compose-boot.override.yml')).toContain('ports: !reset []');
    // Valores sinteticos: nenhum segredo real no fixture.
    expect(read('infra/https/test-boot.env')).not.toMatch(/(PASSWORD|SECRET|KEY)=(?!ficticio)/);
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

  it('a sessao do WhatsApp fica FORA do backup: so os dados de autenticacao, so essas duas tabelas', () => {
    const ignoradas = [...backup.matchAll(/--ignore-table="?\$MYSQL_DATABASE\.(\w+)"?/g)].map(
      (m) => m[1],
    );

    expect(ignoradas.sort()).toEqual(['whatsapp_auth_lock', 'whatsapp_auth_state']);
    // A estrutura vai VAZIA (a tabela `migrations` registra a migration; sem as tabelas a restauracao quebraria).
    expect(backup).toMatch(
      /mysqldump \$COMMON --no-data "\$MYSQL_DATABASE" whatsapp_auth_state whatsapp_auth_lock/,
    );
    // O dump completo continua sendo do banco inteiro, com falha propagada entre os dois dumps.
    expect(backup).toMatch(/set -e;[^']*--databases "\$MYSQL_DATABASE"/);
    expect(backup).toContain('--single-transaction');
    // Nenhuma outra tabela de negocio, auditoria ou NFS-e e excluida.
    expect(backup).not.toMatch(/--ignore-table="\$MYSQL_DATABASE\.(?!whatsapp_auth_)/);
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

  it('retencao local preserva um minimo e nao apaga backup com envio externo pendente', () => {
    expect(backup).toContain('BACKUP_KEEP_MIN');
    expect(backup).toContain('pending_marker');
    expect(backup).toMatch(/continue.*preservar/);
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

  describe('dominio gratuito DuckDNS e webhook HTTPS', () => {
    const init = read('scripts/https-init.sh');
    const dominio = ((): RegExp => {
      const m = /\[\[ "\$SERVER_NAME" =~ (\^.+\$) \]\]/.exec(init);
      if (m?.[1] === undefined) {
        throw new Error('validacao de SERVER_NAME nao encontrada em https-init.sh');
      }
      return new RegExp(m[1]);
    })();

    it('https-init aceita um subdominio DuckDNS e recusa valores que nao sao dominio', () => {
      for (const valido of ['vastaflow.duckdns.org', 'meu-app.duckdns.org', 'app.cliente.com.br']) {
        expect(dominio.test(valido)).toBe(true);
      }
      for (const invalido of [
        'https://vastaflow.duckdns.org',
        'vastaflow.duckdns.org/',
        'localhost',
        'Vasta.duckdns.org',
        'a b.com',
        '',
      ]) {
        expect(dominio.test(invalido)).toBe(false);
      }
      // O bloqueio de nomes ficticios nao pode pegar o DuckDNS.
      const bloqueados = /case "\$SERVER_NAME" in\s+(\*\.example\S*)/.exec(init)?.[1] ?? '';
      expect(bloqueados).not.toMatch(/duckdns/);
      expect(init).toContain('*.duckdns.org)');
      expect(init).toMatch(/DNS TEM de apontar/);
      expect(init).toContain('ainda nao resolve no DNS');
    });

    it('nenhum dominio e fixo: SERVER_NAME e obrigatorio no Compose HTTPS e vazio nos modelos', () => {
      expect(read('docker-compose.https.yml')).toContain('${SERVER_NAME:?');
      expect(semComentarios(read('.env.example'))).toMatch(/^SERVER_NAME=$/m);
      expect(semComentarios(read('.env.example'))).toMatch(/^LETSENCRYPT_EMAIL=$/m);
    });

    it('duckdns-update: token por stdin (nunca no argv), so HTTPS, sem redirecionamento, sem eco', () => {
      const script = semComentarios(read('scripts/duckdns-update.sh'));
      expect(script).toMatch(/curl[^\n]*-K -/);
      expect(script).toContain('--max-redirs 0');
      expect(script).toContain('--proto');
      expect(script).toContain('"=https"');
      // O token so aparece na montagem da URL entregue ao curl por stdin.
      const usos = script.split('\n').filter((linha) => linha.includes('DUCKDNS_TOKEN'));
      for (const linha of usos) {
        expect(linha).not.toMatch(/echo.*[$]\{?DUCKDNS_TOKEN|curl.*DUCKDNS_TOKEN/);
      }
      expect(script).not.toMatch(/set -x|xtrace/);
    });

    it('os modelos do DuckDNS vem vazios e o token nunca fica no .env do projeto', () => {
      const modelo = semComentarios(read('infra/duckdns/duckdns.env.example'));
      for (const chave of ['DUCKDNS_DOMAIN', 'DUCKDNS_TOKEN', 'DUCKDNS_IP']) {
        expect(modelo).toMatch(new RegExp(`^${chave}=$`, 'm'));
      }
      expect(read('.env.example')).not.toMatch(/^DUCKDNS_TOKEN=/m);
      expect(read('docker-compose.production.yml')).not.toMatch(/DUCKDNS/);
      expect(read('docker-compose.https.yml')).not.toMatch(/DUCKDNS/);
    });

    it('a URL do webhook e derivada de SERVER_NAME, usa HTTPS e o verificador exige 403/404 sem assinatura', () => {
      const verificador = semComentarios(read('scripts/https-verify.sh'));
      expect(verificador).toContain('WEBHOOK_URL="https://${SERVER_NAME}/api/webhooks/whatsapp"');
      expect(verificador).toMatch(/403\|404\)/);
      expect(verificador).toContain('X-Hub-Signature-256');
      expect(verificador).not.toMatch(/graph\.facebook|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET/);
      // Sem variavel propria da URL no backend: nao ha como divergir do dominio real.
      expect(read('docker-compose.production.yml')).not.toMatch(
        /WHATSAPP_PUBLIC|WHATSAPP_WEBHOOK_URL/,
      );
    });

    it('o ACME HTTP-01 e atendido pelo webroot na :80 e o redirecionamento nao o captura', () => {
      const modelo = semComentarios(read('infra/https/vastaflow-https.conf.template'));
      const bloco80 = modelo.split('server {')[1] ?? '';
      expect(bloco80).toContain('listen 80;');
      expect(bloco80.indexOf('/.well-known/acme-challenge/')).toBeLessThan(
        bloco80.indexOf('return 301'),
      );
      expect(bloco80).toContain('root /var/www/certbot');
      expect(read('docker-compose.https.yml')).toContain("- '80:80'");
    });

    it('os testes locais de dominio/ACME/DuckDNS existem e sao reproduziveis', () => {
      for (const arquivo of [
        'infra/https/test-https.sh',
        'infra/https/test-acme.sh',
        'infra/https/pebble-config.json',
        'infra/duckdns/test-duckdns.sh',
      ]) {
        expect(existsSync(join(ROOT, arquivo))).toBe(true);
      }
      const pebble = JSON.parse(read('infra/https/pebble-config.json')) as {
        pebble: { httpPort: number };
      };
      expect(pebble.pebble.httpPort).toBe(80);
      expect(read('infra/https/test-https.sh')).toContain('vastaflow.duckdns.org');
    });
  });

  describe('copia externa (Google Drive via rclone), alertas e vigia', () => {
    const lib = semComentarios(read('scripts/lib/backup-remote.sh'));
    const backupSh = semComentarios(read('scripts/backup.sh'));
    const alerta = semComentarios(read('scripts/backup-alert.sh'));

    it('so envia pasta JA cifrada, confere o envio e so poda DEPOIS de conferir', () => {
      expect(lib).toContain('rc check');
      expect(lib).toContain('--one-way');
      const upload = backupSh.indexOf('upload_snapshot "$DEST"');
      const poda = backupSh.indexOf('prune_remote "$STAMP"');
      expect(upload).toBeGreaterThan(0);
      expect(poda).toBeGreaterThan(upload);
      // A poda esta dentro do ramo de sucesso do envio, nunca fora.
      expect(backupSh.slice(upload, poda)).toMatch(/then/);
      expect(backupSh).toContain('gpg');
      expect(backupSh.indexOf('mv "$WORK" "$DEST"')).toBeLessThan(upload);
    });

    it('falha de envio preserva o backup local, marca pendencia, alerta e sai com codigo proprio', () => {
      expect(backupSh).toContain('touch "$(pending_marker "$STAMP")"');
      expect(backupSh).toMatch(/alert FALHA/);
      expect(backupSh).toContain('EXIT_CODE=5');
      expect(backupSh).toContain('retry_pending_uploads');
      expect(backupSh).toContain('preflight_remote');
    });

    it('remocoes no Drive nao vao para a lixeira (que ocupa a cota) e nunca ha rclone cleanup', () => {
      for (const linha of lib.split('\n').filter((l) => l.includes('purge'))) {
        expect(linha).toContain('--drive-use-trash=false');
      }
      const textos = [
        lib,
        backupSh,
        alerta,
        semComentarios(read('scripts/backup-watchdog.sh')),
        semComentarios(read('scripts/backup-fetch.sh')),
      ];
      for (const texto of textos) {
        expect(texto).not.toMatch(/(rclone|[ ]rc)[ ][^\n]*cleanup([ ]|$)/);
      }
    });

    it('checa espaco do destino e do disco local ANTES de gravar, e respeita o orcamento de bytes', () => {
      expect(lib).toContain('BACKUP_REMOTE_MIN_FREE_BYTES');
      expect(lib).toContain('BACKUP_REMOTE_MAX_BYTES');
      expect(lib).toContain('rc about');
      expect(lib).toMatch(/sem_espaco_no_destino/);
      expect(backupSh).toContain('BACKUP_LOCAL_MIN_FREE_BYTES');
      expect(backupSh.indexOf('df -Pk')).toBeLessThan(backupSh.indexOf('[1/5] MySQL'));
    });

    it('a poda recusa apagar se nao consegue listar e nunca toca no recem-enviado nem abaixo do minimo', () => {
      expect(lib).toContain('nao consegui listar o destino');
      expect(lib).toContain('[ "$s" = "$just" ] && continue');
      expect(lib).toMatch(/BACKUP_KEEP_MIN/);
    });

    it('o alerta nunca passa token em argumento de comando e nunca derruba quem o chama', () => {
      expect(alerta).toMatch(/curl[^\n]*-K -/);
      for (const linha of alerta.split('\n').filter((l) => l.includes('curl'))) {
        expect(linha).not.toMatch(/BOT_TOKEN|HEARTBEAT_URL/);
      }
      expect(alerta.trim().endsWith('exit 0')).toBe(true);
      expect(alerta).toContain('--max-redirs 0');
      expect(alerta).toContain('--proto');
    });

    it('as unidades do systemd: falha aciona alerta, vigia diario, agendas persistentes', () => {
      expect(read('infra/backup/vastaflow-backup.service')).toContain(
        'OnFailure=vastaflow-backup-alert.service',
      );
      expect(read('infra/backup/vastaflow-backup-alert.service')).toContain('--se-nao-recente');
      expect(read('infra/backup/vastaflow-backup-watchdog.timer')).toContain('Persistent=true');
      expect(read('infra/backup/vastaflow-backup.timer')).toContain('Persistent=true');
    });

    it('modelos do rclone e do backup: escopo minimo, sem segredo, destino do Drive documentado', () => {
      const rclone = read('infra/backup/rclone.conf.example');
      expect(rclone).toMatch(/^scope = drive[.]file$/m);
      expect(rclone).toMatch(/^token =$/m);
      expect(rclone).toContain('SEU_CLIENT_SECRET');
      const modelo = semComentarios(read('infra/backup/backup.env.example'));
      for (const chave of [
        'BACKUP_ALERT_TELEGRAM_BOT_TOKEN',
        'BACKUP_ALERT_TELEGRAM_CHAT_ID',
        'BACKUP_HEARTBEAT_URL',
        'BACKUP_REMOTE',
      ]) {
        expect(modelo).toMatch(new RegExp(`^${chave}=$`, 'm'));
      }
      expect(modelo).toContain('BACKUP_REMOTE_MAX_BYTES=8589934592');
      expect(read('.gitignore').split(/\r?\n/)).toContain('rclone.conf');
      expect(read('docs/backup-google-drive.md')).toContain('drive.file');
    });

    it('o ensaio de recuperacao da chave GPG usa so dados ficticios, nunca passa frase-senha em argumento e nao toca no chaveiro do usuario', () => {
      const drill = semComentarios(read('scripts/gpg-recovery-drill.sh'));
      expect(drill).toContain('--passphrase-file');
      expect(drill).not.toMatch(/--passphrase[ =]/);
      expect(drill).toContain('--homedir');
      expect(drill).toContain('verify-real');
      expect(drill).toContain('SECRET_TEXT="texto-ficticio-');
      expect(drill).toContain('gpg-agent');
      for (const linha of drill.split('\n').filter((l) => l.includes('export-secret-keys'))) {
        expect(linha).toContain('"$TMP/');
      }
    });

    it('o teste de restauracao nunca herda o destino real do ambiente e so apaga pastas de teste', () => {
      const teste = read('scripts/restore-test.sh');
      expect(teste).toContain('unset BACKUP_REMOTE');
      expect(teste).toContain('*teste*)');
      expect(teste).toContain('nao pode ser a pasta de backups reais');
    });
  });

  it('os scripts existem e comecam com shebang bash', () => {
    for (const script of [
      'backup.sh',
      'restore.sh',
      'restore-test.sh',
      'https-init.sh',
      'https-verify.sh',
      'duckdns-update.sh',
    ]) {
      const caminho = join(ROOT, 'scripts', script);
      expect(existsSync(caminho)).toBe(true);
      expect(readFileSync(caminho, 'utf8').startsWith('#!/usr/bin/env bash\n')).toBe(true);
    }
  });
});
