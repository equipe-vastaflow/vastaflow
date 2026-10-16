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
#   - Retencao local por dias (sempre preserva os N mais recentes) e copia externa opcional via rclone.
#
# VARIAVEIS (backup.env): BACKUP_GPG_RECIPIENT (obrigatoria), BACKUP_DIR, BACKUP_RETENTION_DAYS,
#   BACKUP_KEEP_MIN, BACKUP_REMOTE (ex.: destino:vastaflow-backups), BACKUP_REMOTE_RETENTION_DAYS.
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
REMOTE_RETENTION_DAYS="${BACKUP_REMOTE_RETENTION_DAYS:-30}"
DOCS_VOLUME="${VF_DOCUMENTS_VOLUME:-vastaflow-documents}"
N8N_VOLUME="${VF_N8N_STATE_VOLUME:-vastaflow-n8n-state}"
HELPER_IMAGE="${VF_HELPER_IMAGE:-alpine:3.20}"
read -r -a COMPOSE <<<"${VF_COMPOSE:-docker compose -f docker-compose.production.yml}"
read -r -a CONFIG_PATHS <<<"${VF_CONFIG_PATHS:-.env infra/tls infra/service-auth}"

case "$RETENTION_DAYS$KEEP_MIN$REMOTE_RETENTION_DAYS" in
  *[!0-9]*) echo "ERRO: BACKUP_RETENTION_DAYS, BACKUP_KEEP_MIN e BACKUP_REMOTE_RETENTION_DAYS devem ser inteiros." >&2; exit 2 ;;
esac
command -v gpg >/dev/null || { echo "ERRO: gpg nao encontrado (apt install gnupg)." >&2; exit 2; }
gpg --batch --list-keys "$BACKUP_GPG_RECIPIENT" >/dev/null 2>&1 \
  || { echo "ERRO: a chave publica ${BACKUP_GPG_RECIPIENT} nao esta no chaveiro do usuario que roda o backup." >&2; exit 2; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

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

encrypt_to() {
  gpg --batch --yes --quiet --trust-model always --cipher-algo AES256 --compress-algo none \
      --recipient "$BACKUP_GPG_RECIPIENT" --output "$1" --encrypt
}
require_nonempty() {
  [ -s "$1" ] || { echo "ERRO: ${1##*/} saiu vazio; backup abortado." >&2; exit 4; }
}

echo "[1/5] MySQL (mysqldump --single-transaction)..."
"${COMPOSE[@]}" exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --quick --routines --triggers --events --hex-blob --set-gtid-purged=OFF --default-character-set=utf8mb4 --databases "$MYSQL_DATABASE"' \
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
  if [ -n "$(find "$d" -maxdepth 0 -mtime +"$RETENTION_DAYS" 2>/dev/null)" ]; then
    rm -rf -- "$d"; echo "      retencao: removido $(basename "$d")"
  fi
done

# Copia externa (opcional). O destino e escolha do dono do projeto (docs/backup-restauracao.md).
if [ -n "${BACKUP_REMOTE:-}" ]; then
  command -v rclone >/dev/null || { echo "ERRO: BACKUP_REMOTE definido mas rclone nao esta instalado." >&2; exit 5; }
  echo "Copiando para o destino externo..."
  rclone copy "$DEST" "${BACKUP_REMOTE}/${STAMP}" --checksum --quiet
  rclone check "$DEST" "${BACKUP_REMOTE}/${STAMP}" --one-way --quiet
  rclone delete "$BACKUP_REMOTE" --min-age "${REMOTE_RETENTION_DAYS}d" --quiet || true
  rclone rmdirs "$BACKUP_REMOTE" --leave-root --quiet || true
  echo "Destino externo verificado (rclone check)."
else
  echo "AVISO: BACKUP_REMOTE nao definido: este backup existe SO neste servidor (nao protege contra perda da VPS)."
fi

echo "BACKUP OK: ${DEST}"
du -sh "$DEST" 2>/dev/null | cut -f1 | sed 's/^/tamanho: /'
