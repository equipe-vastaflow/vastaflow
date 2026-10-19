#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - TESTE DE RESTAURACAO de ponta a ponta, isolado, com dados SINTETICOS.
# ---------------------------------------------------------------------------
#   bash scripts/restore-test.sh        (exit 0 = restauracao comprovada)
#
# O que prova (cada passo imprime a evidencia):
#   1. sobe uma stack DESCARTAVEL (projeto Compose vf-rt-src: MySQL com TLS, PostgreSQL, migrate e o
#      backend REAIS desta versao) e cria dados pela API real: um ADMIN, lancamentos, um documento;
#   2. roda scripts/backup.sh com um chaveiro que so tem a chave PUBLICA;
#   3. confere que o backup NAO contem texto em claro e que NAO e decifravel sem a chave privada;
#   4. confere que um arquivo adulterado e rejeitado antes de restaurar qualquer coisa;
#   5. DESTROI a stack de origem (down -v do projeto descartavel);
#   6. sobe uma stack nova e VAZIA (vf-rt-dst) e restaura com scripts/restore.sh, depois de provar que as
#      travas (alvo nao confirmado, producao, alvo nao vazio) recusam;
#   (RT_REMOTE=1: o passo 2 tambem envia ao destino externo SIMULADO, apaga a copia local e o passo 6 restaura do que foi BAIXADO;
#    RT_REMOTE_TARGET=<remoto:pasta-teste>: usa um destino REAL, so com sua autorizacao, so com dados sinteticos.)
#   7. liga o backend sobre os dados restaurados e confere, pela API, login do ADMIN, lancamentos, saldo e o
#      documento (hash identico); confere PostgreSQL, estado do n8n e configuracao.
#
# NUNCA toca os bancos nem os volumes reais: nomes `vf-rt-*`, volumes do projeto descartavel, nenhuma porta
# publicada, senhas aleatorias geradas aqui. NAO testa: n8n subindo sobre o PostgreSQL restaurado (so os dados
# sao comparados), nem copia para destino externo (rclone), nem Linux/VPS (roda no host em que for executado).
# ===========================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1
umask 077

cd "$(dirname "$0")/.."
# O teste NUNCA herda o destino externo do ambiente (BACKUP_REMOTE real): so o que ele mesmo define (RT_REMOTE*).
unset BACKUP_REMOTE BACKUP_ALERT_TELEGRAM_BOT_TOKEN BACKUP_ALERT_TELEGRAM_CHAT_ID BACKUP_HEARTBEAT_URL
REPO="$PWD"
SRC_P="vf-rt-src"
DST_P="vf-rt-dst"
TLS_VOL="vf-restore-test-tls"
COMPOSE_FILE="infra/restore-test/compose.yml"
NODE_IMAGE="node:24.15.0-bookworm-slim"
HELPER="alpine:3.20"

for img in vastaflow-migrate:latest vastaflow-backend:latest; do
  docker image inspect "$img" >/dev/null 2>&1 || { echo "ERRO: imagem $img ausente. Rode: docker compose -f docker-compose.production.yml build backend migrate" >&2; exit 2; }
done
command -v gpg >/dev/null || { echo "ERRO: gpg ausente" >&2; exit 2; }

TMP="$(mktemp -d)"
chmod 700 "$TMP"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FALHA- $1"; }
expect_ok()   { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
expect_fail() { if eval "$2" >/dev/null 2>&1; then bad "$1"; else ok "$1"; fi; }

dc() { # dc <projeto> <args...>  - SO projetos descartaveis (vf-rt-*)
  local project="$1"; shift
  case "$project" in vf-rt-*) ;; *) echo "RECUSADO: projeto $project nao e descartavel" >&2; exit 9 ;; esac
  docker compose -p "$project" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  set +e
  # Destino REAL de teste (se houve): apaga a pasta de teste de verdade, sem lixeira.
  if [ "${RT_REAL_REMOTE:-0}" = "1" ] && [ -n "${BACKUP_REMOTE:-}" ]; then
    env -u MSYS_NO_PATHCONV rclone purge "$BACKUP_REMOTE" --drive-use-trash=false >/dev/null 2>&1
  fi
  dc "$SRC_P" down -v --remove-orphans >/dev/null 2>&1
  dc "$DST_P" down -v --remove-orphans >/dev/null 2>&1
  # Volumes criados a mao (nao pertencem ao Compose, entao o `down -v` nao os remove).
  docker volume rm "${SRC_P}_n8n-state" "${DST_P}_n8n-state" "${DST_P}_documents" >/dev/null 2>&1
  docker volume rm "$TLS_VOL" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

# --- segredos SINTETICOS (aleatorios, so em memoria/ambiente) ---------------------------------------------
rnd() { openssl rand -hex 16; }
export RT_DB_ROOT_PASSWORD="$(rnd)" RT_DB_PASSWORD="$(rnd)" RT_PG_PASSWORD="$(rnd)" RT_JWT_SECRET="$(rnd)$(rnd)"
ADMIN_EMAIL="admin@vastaflow-rt.test"
ADMIN_PASSWORD="Aa1-$(rnd)"
export RT_ADMIN_EMAIL="$ADMIN_EMAIL" RT_ADMIN_PASSWORD="$ADMIN_PASSWORD"

# --- chaves: o servidor so tem a PUBLICA --------------------------------------------------------------------
PRIV_HOME="$TMP/gnupg-privado"; PUB_HOME="$TMP/gnupg-publico"
mkdir -p "$PRIV_HOME" "$PUB_HOME"; chmod 700 "$PRIV_HOME" "$PUB_HOME"
GNUPGHOME="$PRIV_HOME" gpg --batch --quiet --passphrase '' --quick-generate-key "restore-test@vastaflow.invalid" rsa3072 encr never 2>/dev/null
FPR="$(GNUPGHOME="$PRIV_HOME" gpg --batch --with-colons --list-keys restore-test@vastaflow.invalid | awk -F: '/^fpr/ {print $10; exit}')"
GNUPGHOME="$PRIV_HOME" gpg --batch --quiet --export "$FPR" | GNUPGHOME="$PUB_HOME" gpg --batch --quiet --import 2>/dev/null
echo "Chave de teste ${FPR:0:16}... (privada fora do 'servidor': chaveiro so-publico usado no backup)"

echo; echo "== 1. Origem descartavel (${SRC_P}) com dados sinteticos"
docker volume rm "$TLS_VOL" >/dev/null 2>&1 || true
docker volume create "$TLS_VOL" >/dev/null
docker run --rm -v "$TLS_VOL:/tls" "$HELPER" sh -c '
  apk add --no-cache openssl >/dev/null &&
  cd /tls &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=restore-test-ca" -keyout ca-key.pem -out ca.pem 2>/dev/null &&
  openssl req -nodes -newkey rsa:2048 -subj "/CN=mysql" -keyout server-key.pem -out server.csr 2>/dev/null &&
  printf "subjectAltName=DNS:mysql\n" > san.cnf &&
  openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 1 -extfile san.cnf -out server-cert.pem 2>/dev/null &&
  rm -f ca-key.pem && chmod 644 *.pem'

dc "$SRC_P" up -d --wait --wait-timeout 420 mysql n8n-postgres >/dev/null
dc "$SRC_P" up --no-deps migrate 2>&1 | grep -E "executed successfully|No migrations are pending" | tail -1
RT_SEED_ADMIN_EMAIL="$ADMIN_EMAIL" RT_SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" dc "$SRC_P" up -d --no-deps --wait --wait-timeout 420 backend >/dev/null

run_driver() { # run_driver <projeto> <modo> [env...]
  local project="$1" mode="$2"; shift 2
  docker run --rm --network "${project}_rt" -v "$REPO/infra/restore-test:/d:ro" \
    -e RT_ADMIN_EMAIL -e RT_ADMIN_PASSWORD "$@" "$NODE_IMAGE" node /d/driver.mjs "$mode"
}
EXPECTED="$(run_driver "$SRC_P" seed)"
echo "  dados criados pela API: $EXPECTED"

PG_SQL="CREATE TABLE sintetico(id int primary key, txt text); INSERT INTO sintetico SELECT g, 'linha-sintetica-'||g FROM generate_series(1,2000) g;"
dc "$SRC_P" exec -T n8n-postgres sh -c "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -q -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"$PG_SQL\"" >/dev/null
PG_SUM_Q="SELECT md5(string_agg(id||txt, ',' ORDER BY id)) || ' ' || count(*) FROM sintetico"
pg_sum() { dc "$1" exec -T n8n-postgres sh -c "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tA -c \"$PG_SUM_Q\"" | tr -d '\r'; }
PG_BEFORE="$(pg_sum "$SRC_P")"
echo "  postgres sintetico (md5 contagem): $PG_BEFORE"

mysql_sum() { dc "$1" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B "$MYSQL_DATABASE" -e "SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM financial_entries),(SELECT COUNT(*) FROM documents),(SELECT COUNT(*) FROM migrations)"' | tr -d '\r' | tr '\t' ' '; }
MY_BEFORE="$(mysql_sum "$SRC_P")"
echo "  mysql (usuarios lancamentos documentos migrations): $MY_BEFORE"

N8N_FILE_CONTENT="estado-sintetico-do-n8n-$(rnd)"
docker volume create "${SRC_P}_n8n-state" >/dev/null
docker run --rm -v "${SRC_P}_n8n-state:/data" "$HELPER" sh -c "echo '$N8N_FILE_CONTENT' > /data/config-sintetica"

mkdir -p "$TMP/config-sintetica/infra/tls"
printf 'SEGREDO_SINTETICO=%s\n' "$(rnd)" > "$TMP/config-sintetica/.env"
printf 'ca-sintetica\n' > "$TMP/config-sintetica/infra/tls/ca.pem"
CFG_SECRET="$(cut -d= -f2 "$TMP/config-sintetica/.env")"

echo; echo "== 2. Backup (so a chave PUBLICA no chaveiro)"
export BACKUP_ENV_FILE="$TMP/nao-existe.env" BACKUP_GPG_RECIPIENT="$FPR" BACKUP_DIR="$TMP/backups" BACKUP_RETENTION_DAYS=14
export VF_COMPOSE="docker compose -p ${SRC_P} -f ${COMPOSE_FILE}" VF_DOCUMENTS_VOLUME="${SRC_P}_documents" VF_N8N_STATE_VOLUME="${SRC_P}_n8n-state"
export VF_CONFIG_PATHS="$TMP/config-sintetica/.env $TMP/config-sintetica/infra/tls"
if [ "${RT_REMOTE:-0}" = "1" ]; then
  # Copia EXTERNA simulada: um remoto rclone do tipo `local` (pasta temporaria), sem arquivo de configuracao e sem
  # conta nenhuma. Prova o caminho envio -> conferencia -> download -> restauracao com os dados sinteticos.
  command -v rclone >/dev/null || { echo "ERRO: RT_REMOTE=1 exige rclone no PATH." >&2; exit 2; }
  wp() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
  : > "$TMP/rclone-vazio.conf"
  export RCLONE_CONFIG="$(wp "$TMP/rclone-vazio.conf")" RCLONE_CONFIG_RTREMOTE_TYPE=local
  export BACKUP_REMOTE="rtremote:$(wp "$TMP")/destino-externo"
  echo "  (copia externa simulada ligada: ${BACKUP_REMOTE%%:*}:<pasta temporaria>)"
  if [ -n "${RT_REMOTE_TARGET:-}" ]; then
    # Destino REAL escolhido por voce (ex.: gdrive:vastaflow-teste-restauracao), com SO dados sinteticos. Trava: o
    # nome da pasta precisa conter "teste", porque o teste APAGA essa pasta no fim (nunca a pasta de backups reais).
    case "$RT_REMOTE_TARGET" in
      *teste*) ;;
      *) echo "ERRO: RT_REMOTE_TARGET precisa conter 'teste' no nome da pasta (ele e apagado ao final)." >&2; exit 2 ;;
    esac
    case "$RT_REMOTE_TARGET" in *vastaflow-backups*) echo "ERRO: RT_REMOTE_TARGET nao pode ser a pasta de backups reais." >&2; exit 2 ;; esac
    export BACKUP_REMOTE="$RT_REMOTE_TARGET"
    RT_REAL_REMOTE=1
    echo "  (destino REAL de teste: ${BACKUP_REMOTE%%:*}:...; so dados sinteticos; a pasta sera apagada no fim)"
  fi
fi
GNUPGHOME="$PUB_HOME" bash scripts/backup.sh | sed 's/^/  | /'
BK="$(find "$TMP/backups" -maxdepth 1 -type d -name '20*Z' | head -n1)"
[ -n "$BK" ] || { echo "ERRO: backup nao gerado"; exit 1; }
if [ "${RT_REMOTE:-0}" = "1" ]; then
  STAMP_DIR="$(basename "$BK")"
  expect_ok "o backup chegou ao destino externo, conferido" "rclone lsf '$BACKUP_REMOTE/$STAMP_DIR' | grep -q SHA256SUMS && (cd '$BK' && sha256sum -c SHA256SUMS --quiet)"
  rm -rf "$BK"
  echo "  copia LOCAL apagada: a restauracao usara SO o que foi baixado do destino externo"
  bash scripts/backup-fetch.sh "$STAMP_DIR" "$TMP/baixado" | sed 's/^/  | /'
  BK="$TMP/baixado"
fi
ls -l "$BK" | awk 'NR>1 {printf "  | %-28s %s bytes\n", $9, $5}'

echo; echo "== 3. O backup e opaco e protegido"
expect_ok   "SHA256SUMS confere" "(cd '$BK' && sha256sum -c SHA256SUMS --quiet)"
for needle in "Receita sintetica" "linha sintetica" "linha-sintetica" "$ADMIN_EMAIL" "$CFG_SECRET" "CREATE TABLE" "$RT_DB_PASSWORD"; do
  if grep -rqaF -- "$needle" "$BK"; then bad "texto em claro encontrado no backup: ${needle:0:20}"; else ok "backup nao contem '${needle:0:20}...'"; fi
done
expect_fail "sem a chave privada NAO decifra (chaveiro do servidor)" "GNUPGHOME='$PUB_HOME' gpg --batch --quiet --decrypt '$BK/mysql.sql.gz.gpg'"
expect_ok   "com a chave privada decifra e o dump e um dump MySQL" "GNUPGHOME='$PRIV_HOME' gpg --batch --quiet --decrypt '$BK/mysql.sql.gz.gpg' | gunzip | head -c 4000 | grep -q 'MySQL dump'"
expect_fail "manifesto nao carrega segredo" "grep -qiE 'password|senha|secret|token' '$BK/MANIFESTO.txt'"

echo; echo "== 4. Adulteracao e rejeitada antes de restaurar"
cp -r "$BK" "$TMP/adulterado"
printf 'X' | dd of="$TMP/adulterado/mysql.sql.gz.gpg" bs=1 seek=100 conv=notrunc 2>/dev/null
expect_fail "backup adulterado e recusado" "VF_COMPOSE='docker compose -p ${DST_P} -f ${COMPOSE_FILE}' VF_RESTORE_CONFIRM=restaurar-em-${DST_P} GNUPGHOME='$PRIV_HOME' bash scripts/restore.sh '$TMP/adulterado'"

echo; echo "== 5. Origem DESTRUIDA (down -v do projeto descartavel)"
dc "$SRC_P" down -v --remove-orphans >/dev/null 2>&1
expect_fail "volume de documentos da origem nao existe mais" "docker volume inspect ${SRC_P}_documents"
expect_fail "volume do MySQL da origem nao existe mais"     "docker volume inspect ${SRC_P}_mysql-data"

echo; echo "== 6. Destino NOVO e vazio (${DST_P}) e as travas do restore"
dc "$DST_P" up -d --wait --wait-timeout 420 mysql n8n-postgres >/dev/null
export VF_COMPOSE="docker compose -p ${DST_P} -f ${COMPOSE_FILE}" VF_DOCUMENTS_VOLUME="${DST_P}_documents" VF_N8N_STATE_VOLUME="${DST_P}_n8n-state"
export GNUPGHOME="$PRIV_HOME"
expect_fail "sem confirmacao de alvo: recusado"            "env -u VF_RESTORE_CONFIRM bash scripts/restore.sh '$BK'"
expect_fail "confirmacao do projeto errado: recusado"      "VF_RESTORE_CONFIRM=restaurar-em-outro bash scripts/restore.sh '$BK'"
expect_fail "producao sem a trava explicita: recusado"     "VF_COMPOSE='docker compose -f docker-compose.production.yml' VF_RESTORE_CONFIRM=restaurar-em-vastaflow bash scripts/restore.sh '$BK'"

echo "  restaurando de verdade no destino vazio..."
VF_RESTORE_CONFIRM="restaurar-em-${DST_P}" VF_CONFIG_OUT="$TMP/config-restaurada" bash scripts/restore.sh "$BK" | sed 's/^/  | /'
expect_fail "segunda restauracao sobre dados existentes: recusada" "VF_RESTORE_CONFIRM=restaurar-em-${DST_P} VF_CONFIG_OUT='$TMP/config-2' bash scripts/restore.sh '$BK'"

echo; echo "== 7. O sistema USA os dados restaurados"
MY_AFTER="$(mysql_sum "$DST_P")"
PG_AFTER="$(pg_sum "$DST_P")"
[ "$MY_BEFORE" = "$MY_AFTER" ] && ok "MySQL: contagens identicas ($MY_AFTER)" || bad "MySQL difere: antes [$MY_BEFORE] depois [$MY_AFTER]"
[ "$PG_BEFORE" = "$PG_AFTER" ] && ok "PostgreSQL: md5 e contagem identicos ($PG_AFTER)" || bad "PostgreSQL difere: antes [$PG_BEFORE] depois [$PG_AFTER]"
N8N_AFTER="$(docker run --rm -v "${DST_P}_n8n-state:/data:ro" "$HELPER" cat /data/config-sintetica | tr -d '\r')"
[ "$N8N_AFTER" = "$N8N_FILE_CONTENT" ] && ok "estado do n8n restaurado (arquivo identico)" || bad "estado do n8n difere"
RESTORED_ENV="$(find "$TMP/config-restaurada" -name .env | head -n1)"
[ -n "$RESTORED_ENV" ] && [ "$(cut -d= -f2 "$RESTORED_ENV")" = "$CFG_SECRET" ]   && ok "configuracao restaurada em pasta nova (nao sobrescreve a existente)" || bad "configuracao restaurada difere"

MIGR="$(dc "$DST_P" up --no-deps migrate 2>&1 | grep -E "No migrations are pending|executed successfully" | tail -1)"
echo "  migrate sobre os dados restaurados: ${MIGR}"
case "$MIGR" in *"No migrations are pending"*) ok "schema restaurado esta completo (nenhuma migration pendente)" ;; *) bad "migrations pendentes apos a restauracao" ;; esac
RT_SEED_ADMIN_EMAIL="" RT_SEED_ADMIN_PASSWORD="" dc "$DST_P" up -d --no-deps --wait --wait-timeout 420 backend >/dev/null
RESULT="$(run_driver "$DST_P" verify -e "RT_EXPECTED=$EXPECTED")" && ok "API: login do ADMIN restaurado, lancamentos, saldo e documento (hash) conferem" || bad "API nao confere com a origem"
echo "  resultado lido pela API: $RESULT"

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ] && echo "RESTORE TEST: PASS" || { echo "RESTORE TEST: FAIL"; exit 1; }
