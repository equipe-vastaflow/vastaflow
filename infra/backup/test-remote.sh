#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - testes da COPIA EXTERNA, dos ALERTAS e do VIGIA, com dados FICTICIOS e SEM Google Drive.
# ---------------------------------------------------------------------------
# O "destino" aqui e um remoto rclone do tipo `local` (uma pasta temporaria) definido so por variavel de ambiente:
# nenhum arquivo de configuracao do rclone e lido (RCLONE_CONFIG aponta para um arquivo vazio) e nenhuma conta
# Google e tocada. O servidor do Telegram e FALSO (loopback). Prova o COMPORTAMENTO (envio, conferencia, pendencia,
# espaco, orcamento, retencao, alertas, vigia). NAO prova: autenticacao OAuth, cota e limites reais do Google Drive.
#   RCLONE_DIR=<pasta do rclone> bash infra/backup/test-remote.sh      (exit 0 = tudo passou; precisa de rclone no PATH ou RCLONE_DIR)
# ===========================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."
[ -z "${RCLONE_DIR:-}" ] || export PATH="$RCLONE_DIR:$PATH"
command -v rclone >/dev/null || { echo "ERRO: rclone nao encontrado (defina RCLONE_DIR)." >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT
wp() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }   # caminho que o rclone.exe entende

export RCLONE_CONFIG="$(wp "$TMP")/rclone-vazio.conf"; : > "$TMP/rclone-vazio.conf"
export RCLONE_CONFIG_VFTEST_TYPE=local
export BACKUP_DIR="$TMP/local"; mkdir -p "$BACKUP_DIR"
export BACKUP_REMOTE="vftest:$(wp "$TMP")/remoto/vastaflow"
export BACKUP_ENV_FILE="$TMP/nao-existe.env"
export BACKUP_ALERT_STATE_DIR="$TMP/alertas"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FALHA- $1  [$2]"; }
t()   { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1" "$2"; fi; }
nt()  { if eval "$2" >/dev/null 2>&1; then bad "$1" "$2"; else ok "$1"; fi; }

# shellcheck source=../../scripts/lib/backup-remote.sh
. scripts/lib/backup-remote.sh

# Backup FICTICIO: arquivos com bytes aleatorios + SHA256SUMS (como o backup.sh gera).
make_snapshot() { # make_snapshot <carimbo> [kb]
  local d="$BACKUP_DIR/$1" kb="${2:-8}"
  mkdir -p "$d"; head -c $((kb * 1024)) /dev/urandom > "$d/mysql.sql.gz.gpg"; head -c 2048 /dev/urandom > "$d/config.tar.gz.gpg"
  echo "vastaflow-backup v1 ficticio $1" > "$d/MANIFESTO.txt"
  (cd "$d" && sha256sum -- * > SHA256SUMS)
}
remote_dir="$TMP/remoto/vastaflow"

echo "== 1. envio, conferencia e download"
make_snapshot 20261016T033000Z
t  "preflight_remote aprova (destino alcancavel, espaco ok)" "preflight_remote 10240"
t  "upload_snapshot envia e confere (rclone check)" "upload_snapshot '$BACKUP_DIR/20261016T033000Z'"
t  "os 4 arquivos estao no destino" "[ \$(ls '$remote_dir/20261016T033000Z' | wc -l) -eq 4 ]"
t  "remote_latest_stamp devolve o carimbo enviado" "[ \"\$(remote_latest_stamp)\" = 20261016T033000Z ]"
t  "backup-fetch baixa e confere o SHA256SUMS" "bash scripts/backup-fetch.sh latest '$TMP/baixado'"
t  "o baixado e identico ao original" "diff -r '$BACKUP_DIR/20261016T033000Z' '$TMP/baixado'"
printf 'X' | dd of="$remote_dir/20261016T033000Z/mysql.sql.gz.gpg" bs=1 seek=50 conv=notrunc 2>/dev/null
nt "arquivo ADULTERADO no destino: o fetch RECUSA (hash nao confere)" "bash scripts/backup-fetch.sh 20261016T033000Z '$TMP/baixado2'"
nt "o fetch nao deixa a pasta de um download invalido" "[ -d '$TMP/baixado2' ]"
t  "o conferir do envio detecta divergencia (rclone check falha)" "! rc check '$BACKUP_DIR/20261016T033000Z' '$BACKUP_REMOTE/20261016T033000Z' --one-way"
rm -rf "$remote_dir"

echo "== 2. falha de envio: backup local preservado, pendencia e reenvio"
make_snapshot 20261017T033000Z
BAD_REMOTE="$BACKUP_REMOTE"
export BACKUP_REMOTE="vftest:$(wp "$TMP")/arquivo-comum/vastaflow"       # 'arquivo-comum' e um ARQUIVO: nao da para criar pasta dentro
: > "$TMP/arquivo-comum"
nt "destino inutilizavel: preflight REPROVA" "preflight_remote 1024"
t  "causa informada em codigo curto" "[ \"\$REMOTE_PROBLEM\" = destino_inalcancavel ]"
touch "$(pending_marker 20261017T033000Z)"
export BACKUP_REMOTE="$BAD_REMOTE"
t  "o backup local continua la" "[ -d '$BACKUP_DIR/20261017T033000Z' ]"
t  "retry_pending_uploads reenvia quando o destino volta" "retry_pending_uploads"
t  "o marcador de pendencia some depois do envio" "[ ! -f '$(pending_marker 20261017T033000Z)' ]"
t  "o destino agora tem o backup pendente" "[ -d '$remote_dir/20261017T033000Z' ]"
touch "$(pending_marker 20261099T000000Z)"                                  # marcador orfao (backup local nao existe mais)
t  "marcador orfao e descartado sem erro" "retry_pending_uploads && [ ! -f '$(pending_marker 20261099T000000Z)' ]"

echo "== 3. espaco insuficiente no destino"
FREE="$(remote_free_bytes)"
t  "free_bytes do destino e legivel (rclone about)" "[ -n '$FREE' ] && [ '$FREE' -gt 0 ]"
( export BACKUP_REMOTE_MIN_FREE_BYTES=$((FREE + 1073741824)); nt "folga exigida maior que o livre: preflight RECUSA" "preflight_remote 1024"; [ "$REMOTE_PROBLEM" = sem_espaco_no_destino ] ) \
  && ok "causa = sem_espaco_no_destino" || bad "causa = sem_espaco_no_destino" "$REMOTE_PROBLEM"
( export BACKUP_REMOTE_MAX_BYTES=1000; nt "backup maior que o orcamento: preflight RECUSA" "preflight_remote 5000" )
( preflight_remote 5000; [ "$REMOTE_PROBLEM" = "" ] ) && ok "orcamento folgado: preflight aprova" || bad "orcamento folgado" "-"

echo "== 4. retencao por faixas (funcao pura)"
gen() { local i; for i in $(seq 0 59); do d=$(date -u -d "2026-10-16 -${i} days" +%Y%m%d); echo "${d}T033000Z"; echo "${d}T153000Z"; done; }
KEEP="$(gen | select_keep)"
n="$(wc -l <<<"$KEEP" | tr -d ' ')"
t  "60 dias x 2 backups/dia: mantem so uma pequena parte ($n)" "[ $n -ge 7 ] && [ $n -le 14 ]"
t  "mantem o mais recente de todos" "grep -qx 20261016T153000Z <<<'$KEEP'"
t  "de cada dia mantido fica o MAIS RECENTE (15:30), nunca o das 03:30" "! grep -E '^2026101[0-6]T033000Z$' <<<'$KEEP'"
t  "7 dias diferentes entre os diarios" "[ \$(grep -E '^2026(1010|1011|1012|1013|1014|1015|1016)T' <<<'$KEEP' | wc -l) -eq 7 ]"
t  "backups de ~30 dias atras (fora das faixas) nao sao mantidos" "! grep -q '^20260916' <<<'$KEEP'"
t  "pelo menos um backup de cada um dos 3 ultimos meses" "grep -q '^202610' <<<'$KEEP' && grep -q '^202609' <<<'$KEEP' && grep -q '^202608' <<<'$KEEP'"
t  "entrada com poucos backups: mantem todos" "[ \$(printf '20261015T033000Z\n20261016T033000Z\n' | select_keep | wc -l) -eq 2 ]"
t  "lixo na entrada e ignorado" "[ \$(printf 'lixo\n../etc\n20261016T033000Z\n' | select_keep | wc -l) -eq 1 ]"

echo "== 5. poda no destino (retencao + orcamento) e a regra do nao-apagar"
rm -rf "$remote_dir"; mkdir -p "$remote_dir"
for i in $(seq 0 19); do d=$(date -u -d "2026-10-16 -${i} days" +%Y%m%d); mkdir -p "$remote_dir/${d}T033000Z"; head -c 20000 /dev/urandom > "$remote_dir/${d}T033000Z/x.gpg"; done
t  "prune_remote lista e poda" "prune_remote 20261016T033000Z"
LEFT="$(remote_list_stamps | wc -l | tr -d ' ')"
t  "destino ficou com a retencao (${LEFT} de 20)" "[ $LEFT -lt 20 ] && [ $LEFT -ge 7 ]"
t  "o recem-enviado NUNCA e removido" "[ -d '$remote_dir/20261016T033000Z' ]"
( export BACKUP_REMOTE_MAX_BYTES=50000; prune_remote 20261016T033000Z; [ "$REMOTE_PRUNE_NOTE" = orcamento ] ) && ok "orcamento de bytes estourado: apaga os mais antigos e sinaliza" || bad "poda por orcamento" "nota=$REMOTE_PRUNE_NOTE"
t  "mesmo com orcamento minusculo, sobram >= KEEP_MIN (3) e o mais novo" "[ \$(remote_list_stamps | wc -l) -ge 3 ] && [ -d '$remote_dir/20261016T033000Z' ]"
( BACKUP_REMOTE="vftest:$(wp "$TMP")/arquivo-comum/x"; nt "destino ilistavel: prune se recusa a apagar" "prune_remote 20261016T033000Z" )
t  "nada foi apagado quando a listagem falhou" "[ \$(remote_list_stamps | wc -l) -ge 3 ]"
nt "a biblioteca nunca usa 'rclone cleanup' (esvaziaria a lixeira da conta inteira)" "grep -E '(rclone|[[:space:]]rc)[[:space:]][^#]*cleanup([[:space:]]|$)' scripts/lib/backup-remote.sh scripts/backup*.sh"
t  "toda remocao usa --drive-use-trash=false (senao o espaco nao e liberado)" "grep -q 'purge.*--drive-use-trash=false' scripts/lib/backup-remote.sh"

echo "== 6. alertas (Telegram FALSO em loopback)"
cat > "$TMP/fake-telegram.mjs" <<'JS'
import http from 'node:http';
import fs from 'node:fs';
const [port, log] = process.argv.slice(2);
http.createServer((q, r) => {
  const c = [];
  q.on('data', (x) => c.push(x));
  q.on('end', () => { fs.appendFileSync(log, JSON.stringify({ url: q.url, body: Buffer.concat(c).toString() }) + '\n'); r.end('{"ok":true}'); });
}).listen(Number(port), '127.0.0.1');
JS
PORT=$((20000 + RANDOM % 20000))
node "$TMP/fake-telegram.mjs" "$PORT" "$TMP/telegram.log" &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:${PORT}/" && break; sleep 0.2; done
TOKEN="123456789:$(openssl rand -hex 20 | tr 'a-f' 'A-F')abcdefghij"
alert_env() { env BACKUP_ALERT_TEST_INSECURE=1 BACKUP_ALERT_TELEGRAM_API="http://127.0.0.1:${PORT}" BACKUP_ALERT_TELEGRAM_BOT_TOKEN="$TOKEN" BACKUP_ALERT_TELEGRAM_CHAT_ID=123456789 "$@"; }
OUT="$(alert_env bash scripts/backup-alert.sh FALHA 'envio falhou: teste' 2>&1)"
t  "alerta de falha enviado ao Telegram falso" "grep -q 'sendMessage' '$TMP/telegram.log'"
t  "o texto chegou com nivel e mensagem" "grep -q 'FALHA' '$TMP/telegram.log' && grep -q 'envio+falhou' '$TMP/telegram.log' || grep -q 'envio%20falhou' '$TMP/telegram.log'"
nt "o TOKEN nao aparece na saida do alerta" "grep -qF '$TOKEN' <<<'$OUT'"
t  "o token so foi ao servidor, no caminho da API" "grep -qF 'bot${TOKEN}' '$TMP/telegram.log'"
before="$(wc -l < "$TMP/telegram.log")"
alert_env bash scripts/backup-alert.sh --se-nao-recente 600 FALHA 'duplicado' >/dev/null 2>&1
t  "--se-nao-recente suprime o alerta duplicado" "[ \$(wc -l < '$TMP/telegram.log') -eq $before ]"
alert_env env BACKUP_ALERT_STATE_DIR="$TMP/alertas2" bash scripts/backup-alert.sh FALHA "$(printf 'linha1\nlinha2 com "aspas" e \\ barra')" >/dev/null 2>&1
t  "mensagem com quebra de linha/aspas/barra e entregue sem quebrar" "[ \$(wc -l < '$TMP/telegram.log') -gt $before ]"
nt "token em formato invalido e recusado (nada e enviado)" "[ -n \"\$(env BACKUP_ALERT_TEST_INSECURE=1 BACKUP_ALERT_TELEGRAM_API=http://127.0.0.1:${PORT} BACKUP_ALERT_TELEGRAM_BOT_TOKEN='x; rm -rf /' BACKUP_ALERT_TELEGRAM_CHAT_ID=1 BACKUP_ALERT_STATE_DIR='$TMP/alertas3' bash scripts/backup-alert.sh FALHA x 2>&1 | grep -i 'alerta enviado (')\" ]"
t  "sem canal configurado o script NAO falha (so avisa)" "env -u BACKUP_ALERT_TELEGRAM_BOT_TOKEN BACKUP_ALERT_STATE_DIR='$TMP/alertas4' bash scripts/backup-alert.sh FALHA x"
t  "heartbeat: FALHA chama <URL>/fail" "env BACKUP_ALERT_TEST_INSECURE=1 BACKUP_HEARTBEAT_URL='http://127.0.0.1:${PORT}/ping/abc' BACKUP_ALERT_STATE_DIR='$TMP/alertas5' bash scripts/backup-alert.sh FALHA x && grep -q '/ping/abc/fail' '$TMP/telegram.log'"
nt "heartbeat: AVISO nao envia ping" "env BACKUP_ALERT_TEST_INSECURE=1 BACKUP_HEARTBEAT_URL='http://127.0.0.1:${PORT}/ping/so-aviso' BACKUP_ALERT_STATE_DIR='$TMP/alertas6' bash scripts/backup-alert.sh AVISO x && grep -q 'so-aviso' '$TMP/telegram.log'"
nt "scripts de backup nunca passam token/URL de alerta em argumento de curl" "grep -nE 'curl[^|]*(BOT_TOKEN|bot[$])' scripts/backup-alert.sh"
t  "alerta usa curl -K - (configuracao por stdin)" "grep -q 'curl .*-K -' scripts/backup-alert.sh"

echo "== 7. vigia (watchdog)"
W_ENV=(env BACKUP_ALERT_TEST_INSECURE=1 BACKUP_ALERT_TELEGRAM_API="http://127.0.0.1:${PORT}" BACKUP_ALERT_TELEGRAM_BOT_TOKEN="$TOKEN" BACKUP_ALERT_TELEGRAM_CHAT_ID=123456789 BACKUP_ALERT_STATE_DIR="$TMP/alertas-w")
rm -rf "$BACKUP_DIR"/2026*; rm -f "$BACKUP_DIR"/*.upload-pendente; rm -rf "$remote_dir"
b="$(wc -l < "$TMP/telegram.log")"
nt "sem NENHUM backup: vigia falha" "${W_ENV[*]} bash scripts/backup-watchdog.sh"
t  "e alerta (mensagem citando o problema)" "[ \$(wc -l < '$TMP/telegram.log') -gt $b ] && tail -n1 '$TMP/telegram.log' | grep -q 'nenhum_backup_local'"
NOW_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
make_snapshot "$NOW_STAMP"; upload_snapshot "$BACKUP_DIR/$NOW_STAMP"
rm -rf "$TMP/alertas-w"
t  "backup local e remoto frescos: vigia OK" "${W_ENV[*]} bash scripts/backup-watchdog.sh"
OLD="$(date -u -d '-3 days' +%Y%m%dT%H%M%SZ)"
rm -rf "$BACKUP_DIR/$NOW_STAMP" "$remote_dir/$NOW_STAMP"; make_snapshot "$OLD"; upload_snapshot "$BACKUP_DIR/$OLD"
rm -rf "$TMP/alertas-w"
nt "backups de 3 dias atras: vigia detecta ATRASO" "${W_ENV[*]} bash scripts/backup-watchdog.sh"
make_snapshot "$NOW_STAMP"; upload_snapshot "$BACKUP_DIR/$NOW_STAMP"; touch "$(pending_marker "$NOW_STAMP")"
rm -rf "$TMP/alertas-w"
nt "envio pendente: vigia detecta" "${W_ENV[*]} bash scripts/backup-watchdog.sh"
rm -f "$(pending_marker "$NOW_STAMP")"; rm -rf "$remote_dir"
rm -rf "$TMP/alertas-w"
nt "backup local fresco mas NADA no destino: vigia detecta" "${W_ENV[*]} bash scripts/backup-watchdog.sh"

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ]
