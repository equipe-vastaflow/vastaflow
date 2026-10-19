#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - baixa um backup do destino externo e CONFERE a integridade, para entregar a scripts/restore.sh.
#   bash scripts/backup-fetch.sh <carimbo|latest> <pasta-nova>
# Precisa de BACKUP_REMOTE (e do rclone configurado). Nao decifra nada (a chave privada nao e necessaria aqui).
# ===========================================================================
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

ENV_FILE="${BACKUP_ENV_FILE:-/etc/vastaflow/backup.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
: "${BACKUP_REMOTE:?defina BACKUP_REMOTE (destino rclone)}"
# shellcheck source=lib/backup-remote.sh
. "$(dirname "$0")/lib/backup-remote.sh"

WHICH="${1:-}"; OUT="${2:-}"
[ -n "$WHICH" ] && [ -n "$OUT" ] || { echo "uso: $0 <carimbo|latest> <pasta-nova>" >&2; exit 2; }
[ ! -e "$OUT" ] || { echo "ERRO: ${OUT} ja existe." >&2; exit 2; }

if [ "$WHICH" = "latest" ]; then WHICH="$(remote_latest_stamp)"; fi
[[ "$WHICH" =~ $STAMP_PATTERN ]] || { echo "ERRO: nenhum backup encontrado no destino (ou carimbo invalido)." >&2; exit 3; }

mkdir -p "$OUT"
echo "Baixando ${WHICH}..."
rc copy "$BACKUP_REMOTE/$WHICH" "$OUT" >/dev/null 2>&1 || { echo "ERRO: download falhou." >&2; rm -rf "$OUT"; exit 4; }
(cd "$OUT" && sha256sum -c SHA256SUMS --quiet) || { echo "ERRO: backup baixado nao confere com SHA256SUMS (corrompido ou adulterado); descartado." >&2; rm -rf "$OUT"; exit 5; }
echo "OK: ${OUT} (integridade conferida). Restaurar: VF_RESTORE_CONFIRM=restaurar-em-<projeto> bash scripts/restore.sh ${OUT}"
