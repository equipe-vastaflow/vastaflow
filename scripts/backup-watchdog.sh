#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - VIGIA do backup (roda 1x por dia, separado do backup). Pega o que o backup nao consegue avisar sozinho:
# o agendador que nao rodou, o backup que parou de ser enviado, o espaco do destino acabando, envios pendentes.
#   bash scripts/backup-watchdog.sh        exit 0 = tudo certo; 1 = problema (alerta enviado por scripts/backup-alert.sh)
# Variaveis: BACKUP_MAX_AGE_HOURS (padrao 30), BACKUP_REMOTE e as de scripts/lib/backup-remote.sh.
# ===========================================================================
set -uo pipefail
umask 077
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

ENV_FILE="${BACKUP_ENV_FILE:-/etc/vastaflow/backup.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vastaflow}"
MAX_AGE_H="${BACKUP_MAX_AGE_HOURS:-30}"
[[ "$MAX_AGE_H" =~ ^[0-9]+$ ]] || MAX_AGE_H=30
# shellcheck source=lib/backup-remote.sh
. "$(dirname "$0")/lib/backup-remote.sh"

problems=()

latest_local="$(find "$BACKUP_DIR" -maxdepth 1 -type d -name '20??????T??????Z' 2>/dev/null | sort | tail -n1 | xargs -r basename)"
if [ -z "$latest_local" ]; then
  problems+=("nenhum_backup_local")
else
  age="$(stamp_age_seconds "$latest_local" || echo 999999999)"
  [ "$age" -le $((MAX_AGE_H * 3600)) ] || problems+=("backup_local_atrasado_$((age / 3600))h")
fi

pending="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.upload-pendente' -type f 2>/dev/null | wc -l | tr -d ' ')"
[ "${pending:-0}" -eq 0 ] || problems+=("envios_pendentes_${pending}")

if [ -n "${BACKUP_REMOTE:-}" ]; then
  if ! rc mkdir "$BACKUP_REMOTE" >/dev/null 2>&1; then
    problems+=("destino_inalcancavel")
  else
    latest_remote="$(remote_latest_stamp)"
    if [ -z "$latest_remote" ]; then
      problems+=("nenhum_backup_no_destino")
    else
      rage="$(stamp_age_seconds "$latest_remote" || echo 999999999)"
      [ "$rage" -le $((MAX_AGE_H * 3600)) ] || problems+=("backup_no_destino_atrasado_$((rage / 3600))h")
    fi
    free="$(remote_free_bytes)"
    if [ -n "$free" ] && [ "$free" -lt "$BACKUP_REMOTE_MIN_FREE_BYTES" ]; then problems+=("destino_com_pouco_espaco_$((free / 1048576))MB"); fi
  fi
fi

if [ "${#problems[@]}" -gt 0 ]; then
  echo "PROBLEMAS: ${problems[*]}" >&2
  bash "$(dirname "$0")/backup-alert.sh" FALHA "vigia: ${problems[*]}" || true
  exit 1
fi
echo "Vigia: ok (backup local${BACKUP_REMOTE:+ e destino} em dia, sem pendencias)."
