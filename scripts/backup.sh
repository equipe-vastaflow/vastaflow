#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - backup CIFRADO da stack (MySQL, PostgreSQL do n8n, documentos, estado do n8n, configuracao).
# ---------------------------------------------------------------------------
# Rode no HOST da VPS (agendado por infra/backup/vastaflow-backup.timer). Le /etc/vastaflow/backup.env
# (fora do Git; modelo em infra/backup/backup.env.example).
#
# PRINCIPIOS
#   - Cifra com chave PUBLICA (gpg): o servidor so guarda a chave publica. Quem invadir a VPS nao le os
#     backups antigos. A chave PRIVADA fica FORA do servidor (ver docs/backup-restauracao.md).
#   - Nenhum dado em claro toca o disco: cada fonte e canalizada direto para o gpg.
#   - Consistente: mysqldump --single-transaction (instantaneo InnoDB) e pg_dump (snapshot MVCC). Os
#     documentos (volume) sao copiados DEPOIS dos bancos: um arquivo pode existir sem linha no banco,
#     nunca o contrario (ver docs/backup-restauracao.md, "limites").
#   - Senhas nunca vao em argumento de linha de comando: os dumps usam as variaveis que o proprio
#     container ja tem (MYSQL_ROOT_PASSWORD, POSTGRES_PASSWORD).
#   - Retencao local por dias (sempre preserva os N mais recentes) e copia externa opcional via rclone
#     (scripts/lib/backup-remote.sh): confere espaco ANTES, envia, CONFERE o envio (hash), repete envios que
#     falharam e poda o destino por faixas (7 diarios + 4 semanais + 3 mensais) e por orcamento de bytes.
#   - Falha de envio NUNCA perde o backup local: ele fica com marcador `.upload-pendente`, e o alerta sai
#     (scripts/backup-alert.sh). Codigos de saida: 0 ok; 2 configuracao; 3 trava; 4 dump falhou;
#     5 backup LOCAL ok mas a copia externa falhou (envio pendente); 6 sem espaco no disco local.
#
# VARIAVEIS (backup.env): BACKUP_GPG_RECIPIENT (obrigatoria), BACKUP_DIR, BACKUP_RETENTION_DAYS, BACKUP_KEEP_MIN,
#   BACKUP_REMOTE (ex.: gdrive:vastaflow-backups), BACKUP_REMOTE_MAX_BYTES, BACKUP_REMOTE_MIN_FREE_BYTES,
#   BACKUP_KEEP_DAILY/WEEKLY/MONTHLY, BACKUP_LOCAL_MIN_FREE_BYTES, BACKUP_ALERT_SIZE_BYTES e as de alerta (backup-alert.sh).
# Para testes/ensaios: VF_COMPOSE, VF_DOCUMENTS_VOLUME, VF_N8N_STATE_VOLUME, VF_CONFIG_PATHS.
# ===========================================================================
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1   # Git Bash (Windows) nao pode reescrever caminhos de container

cd "$(dirname "$0")/.."

ENV_FILE="${BACKUP_ENV_FILE:-/etc/vastaflow/backup.env}"
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

: "${BACKUP_GPG_RECIPIENT:?defina BACKUP_GPG_RECIPIENT (impressao digital da chave PUBLICA) em ${ENV_FILE}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vastaflow}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
KEEP_MIN="${BACKUP_KEEP_MIN:-3}"
LOCAL_MIN_FREE="${BACKUP_LOCAL_MIN_FREE_BYTES:-2147483648}"
ALERT_SIZE="${BACKUP_ALERT_SIZE_BYTES:-524288000}"
DOCS_VOLUME="${VF_DOCUMENTS_VOLUME:-vastaflow-documents}"
N8N_VOLUME="${VF_N8N_STATE_VOLUME:-vastaflow-n8n-state}"
HELPER_IMAGE="${VF_HELPER_IMAGE:-alpine:3.20}"
read -r -a COMPOSE <<<"${VF_COMPOSE:-docker compose -f docker-compose.production.yml}"
read -r -a CONFIG_PATHS <<<"${VF_CONFIG_PATHS:-.env infra/tls infra/service-auth}"

case "$RETENTION_DAYS$KEEP_MIN$LOCAL_MIN_FREE$ALERT_SIZE" in
  *[!0-9]*) echo "ERRO: BACKUP_RETENTION_DAYS, BACKUP_KEEP_MIN, BACKUP_LOCAL_MIN_FREE_BYTES e BACKUP_ALERT_SIZE_BYTES devem ser inteiros." >&2; exit 2 ;;
esac
command -v gpg >/dev/null || { echo "ERRO: gpg nao encontrado (apt install gnupg)." >&2; exit 2; }
gpg --batch --list-keys "$BACKUP_GPG_RECIPIENT" >/dev/null 2>&1 \
  || { echo "ERRO: a chave publica ${BACKUP_GPG_RECIPIENT} nao esta no chaveiro do usuario que roda o backup." >&2; exit 2; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# shellcheck source=lib/backup-remote.sh
. "$(dirname "$0")/lib/backup-remote.sh"
alert() { bash "$(dirname "$0")/backup-alert.sh" "$@" >/dev/null 2>&1 || true; }

# Trava contra execucoes simultaneas (mkdir e atomico e portavel).
LOCK="${BACKUP_DIR}/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    echo "AVISO: trava antiga (>6 h) removida." >&2; rmdir "$LOCK"; mkdir "$LOCK"
  else
    echo "ERRO: outro backup esta em andamento (${LOCK})." >&2; exit 3
  fi
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/${STAMP}"
WORK="${DEST}.parcial"
cleanup() { rmdir "$LOCK" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
mkdir -p "$WORK"

# Espaco no disco LOCAL: o backup precisa de ~2x o ultimo + folga. Falhar cedo e alto e melhor que um dump truncado.
last_local="$(find "$BACKUP_DIR" -maxdepth 1 -type d -name '20??????T??????Z' | sort | tail -n1)"
last_size=0; [ -n "$last_local" ] && last_size="$(dir_bytes "$last_local")"
free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
if [ -n "$free_kb" ] && [ $((free_kb * 1024)) -lt $((2 * last_size + LOCAL_MIN_FREE)) ]; then
  echo "ERRO: pouco espaco livre no disco local ($((free_kb / 1024)) MB). Backup nao iniciado." >&2
  alert FALHA "disco local com pouco espaco (${BACKUP_DIR}); backup nao executado"
  exit 6
fi

encrypt_to() {
  gpg --batch --yes --quiet --trust-model always --cipher-algo AES256 --compress-algo none \
      --recipient "$BACKUP_GPG_RECIPIENT" --output "$1" --encrypt
}
require_nonempty() {
  [ -s "$1" ] || { echo "ERRO: ${1##*/} saiu vazio; backup abortado." >&2; exit 4; }
}

# A sessao do WhatsApp (whatsapp_auth_state/whatsapp_auth_lock: credenciais e chaves Signal, mesmo cifradas) NAO entra no backup:
# so essas duas tabelas perdem os DADOS (a estrutura vai, vazia, para a restauracao nao ficar sem elas, ja que a tabela
# `migrations` as registra); todas as demais seguem completas. Perder a sessao custa um novo pareamento por QR.
echo "[1/5] MySQL (mysqldump --single-transaction)..."
"${COMPOSE[@]}" exec -T mysql sh -c \
  'set -e; export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; COMMON="-uroot --single-transaction --quick --hex-blob --set-gtid-purged=OFF --default-character-set=utf8mb4"; mysqldump $COMMON --routines --triggers --events --ignore-table="$MYSQL_DATABASE.whatsapp_auth_state" --ignore-table="$MYSQL_DATABASE.whatsapp_auth_lock" --databases "$MYSQL_DATABASE"; mysqldump $COMMON --no-data "$MYSQL_DATABASE" whatsapp_auth_state whatsapp_auth_lock' \
  | gzip -9 | encrypt_to "$WORK/mysql.sql.gz.gpg"
require_nonempty "$WORK/mysql.sql.gz.gpg"

echo "[2/5] PostgreSQL do n8n (pg_dump -Fc)..."
"${COMPOSE[@]}" exec -T n8n-postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9' \
  | encrypt_to "$WORK/n8n-postgres.pgdump.gpg"
require_nonempty "$WORK/n8n-postgres.pgdump.gpg"

volume_to_archive() { # volume, arquivo de saida, descricao
  if docker volume inspect "$1" >/dev/null 2>&1; then
    docker run --rm -v "$1:/data:ro" "$HELPER_IMAGE" tar -C /data -cf - . | gzip -9 | encrypt_to "$2"
    require_nonempty "$2"
  else
    echo "      (volume $1 ausente: ${3} nao incluido)"
    echo "ausente: $1" > "$WORK/${2##*/}.AUSENTE"
  fi
}
echo "[3/5] Documentos privados (volume ${DOCS_VOLUME})..."
volume_to_archive "$DOCS_VOLUME" "$WORK/documents.tar.gz.gpg" "documentos"
echo "[4/5] Estado do n8n (volume ${N8N_VOLUME})..."
volume_to_archive "$N8N_VOLUME" "$WORK/n8n-state.tar.gz.gpg" "estado do n8n"

echo "[5/5] Configuracao operacional (${CONFIG_PATHS[*]})..."
present=()
for path in "${CONFIG_PATHS[@]}"; do
  if [ -e "$path" ]; then present+=("$path"); else echo "      (ausente, ignorado: $path)"; fi
done
[ "${#present[@]}" -gt 0 ] || { echo "ERRO: nenhum arquivo de configuracao encontrado." >&2; exit 4; }
tar -cf - "${present[@]}" | gzip -9 | encrypt_to "$WORK/config.tar.gz.gpg"
require_nonempty "$WORK/config.tar.gz.gpg"

# Manifesto: SEM segredo (so nomes, tamanhos e hashes dos arquivos JA cifrados).
{
  echo "vastaflow-backup v1"
  echo "criado_em_utc: ${STAMP}"
  echo "host: $(hostname)"
  echo "git_commit: $(git rev-parse --short HEAD 2>/dev/null || echo desconhecido)"
  echo "chave_publica: ${BACKUP_GPG_RECIPIENT}"
  echo "mysql_imagem: $("${COMPOSE[@]}" images mysql --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | head -n1 || echo desconhecida)"
  echo "arquivos:"
  (cd "$WORK" && for f in *; do [ "$f" = MANIFESTO.txt ] || echo "  - $f ($(wc -c <"$f" | tr -d ' ') bytes)"; done)
} > "$WORK/MANIFESTO.txt"
(cd "$WORK" && sha256sum -- * | grep -v ' MANIFESTO.txt$' > SHA256SUMS; sha256sum MANIFESTO.txt >> SHA256SUMS)

mv "$WORK" "$DEST"
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# Retencao local: remove os mais antigos que N dias, mas NUNCA deixa menos que KEEP_MIN.
mapfile -t ALL < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name '20??????T??????Z' | sort -r)
idx=0
for d in "${ALL[@]}"; do
  idx=$((idx + 1))
  [ "$idx" -le "$KEEP_MIN" ] && continue
  if [ -f "$(pending_marker "$(basename "$d")")" ]; then continue; fi   # envio externo pendente: preservar
  if [ -n "$(find "$d" -maxdepth 0 -mtime +"$RETENTION_DAYS" 2>/dev/null)" ]; then
    rm -rf -- "$d"; echo "      retencao: removido $(basename "$d")"
  fi
done

# Tamanho incomum: aviso (um crescimento brusco costuma ser documentos novos ou erro de dump).
SIZE="$(dir_bytes "$DEST")"
if [ "$SIZE" -gt "$ALERT_SIZE" ]; then
  alert AVISO "backup grande: $((SIZE / 1048576)) MB (limite de aviso $((ALERT_SIZE / 1048576)) MB); revise a politica de retencao"
fi

# Copia externa (opcional, mas OBRIGATORIA antes do go-live). O destino e escolha do dono do projeto.
EXIT_CODE=0
if [ -n "${BACKUP_REMOTE:-}" ]; then
  command -v rclone >/dev/null || { echo "ERRO: BACKUP_REMOTE definido mas rclone nao esta instalado." >&2; touch "$(pending_marker "$STAMP")"; alert FALHA "rclone ausente; backup local ok, envio pendente"; exit 5; }
  echo "Copia externa (${BACKUP_REMOTE%%:*}:...)..."
  REMOTE_NOTE=""
  if ! preflight_remote "$SIZE"; then
    echo "ERRO: destino externo nao esta pronto (${REMOTE_PROBLEM}). Backup local preservado; envio PENDENTE." >&2
    touch "$(pending_marker "$STAMP")"
    alert FALHA "copia externa nao enviada: ${REMOTE_PROBLEM}. Backup local ${STAMP} preservado (envio pendente)"
    EXIT_CODE=5
  else
    [ -z "$REMOTE_NOTE" ] || echo "      aviso: ${REMOTE_NOTE}"
    # Primeiro os envios antigos que ficaram pendentes; depois o de agora.
    retry_pending_uploads || EXIT_CODE=5
    if upload_snapshot "$DEST"; then
      rm -f "$(pending_marker "$STAMP")"
      echo "      enviado e conferido (rclone check): ${STAMP}"
      # So PODA depois de o envio novo estar conferido; o recem-enviado nunca e removido.
      prune_remote "$STAMP" || true
      if [ "${REMOTE_PRUNE_NOTE:-}" = "orcamento" ]; then
        alert AVISO "retencao do destino reduzida pelo orcamento de bytes; considere aumentar o espaco ou rever o conteudo do backup"
      fi
    else
      echo "ERRO: envio ao destino externo falhou ou nao conferiu. Backup local preservado; envio PENDENTE." >&2
      touch "$(pending_marker "$STAMP")"
      alert FALHA "envio ao destino externo falhou (backup local ${STAMP} preservado; sera reenviado na proxima execucao)"
      EXIT_CODE=5
    fi
  fi
else
  echo "AVISO: BACKUP_REMOTE nao definido: este backup existe SO neste servidor (nao protege contra perda da VPS)."
fi

echo "BACKUP OK: ${DEST}"
echo "tamanho: $((SIZE / 1024)) KB"
if [ "$EXIT_CODE" -eq 0 ]; then alert OK "backup ${STAMP} concluido ($((SIZE / 1024)) KB${BACKUP_REMOTE:+, copia externa conferida})"; fi
exit "$EXIT_CODE"
