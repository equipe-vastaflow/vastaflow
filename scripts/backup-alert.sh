#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - alerta de backup (Telegram e/ou "heartbeat"). Nunca derruba quem o chama.
# ---------------------------------------------------------------------------
#   bash scripts/backup-alert.sh [--se-nao-recente SEGUNDOS] NIVEL "mensagem curta"
#   NIVEL: OK | AVISO | FALHA
#
# Canais (em /etc/vastaflow/backup.env, fora do Git):
#   BACKUP_ALERT_TELEGRAM_BOT_TOKEN / BACKUP_ALERT_TELEGRAM_CHAT_ID   use um bot SO para alertas (BotFather), nao o do VastaFlow
#   BACKUP_HEARTBEAT_URL   monitor externo no estilo healthchecks.io: OK -> GET na URL; FALHA -> GET em <URL>/fail.
#                          Tambem avisa quando o backup NAO roda (o monitor espera o ping). AVISO nao envia ping.
# A mensagem leva so: nivel, nome da maquina e um texto curto. NUNCA caminho, chave, token ou dado do negocio.
# SEGURANCA: o token vai ao curl por stdin (-K -), nunca em argumento de comando; nada e impresso.
# --se-nao-recente N: nao envia se ja houve alerta nos ultimos N segundos (evita duplicar com o OnFailure do systemd).
# ===========================================================================
set -uo pipefail
umask 077

ENV_FILE="${BACKUP_ENV_FILE:-/etc/vastaflow/backup.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

QUIET_FOR=0
if [ "${1:-}" = "--se-nao-recente" ]; then QUIET_FOR="${2:-0}"; shift 2; fi
LEVEL="${1:-AVISO}"; shift || true
case "$LEVEL" in OK|AVISO|FALHA) ;; *) LEVEL="AVISO" ;; esac
[[ "$QUIET_FOR" =~ ^[0-9]+$ ]] || QUIET_FOR=0

# Texto: uma linha, sem caracteres de controle, ate 300 caracteres.
MSG="$(printf '%s' "$*" | tr -d '\000-\037' | cut -c1-300)"
TEXT="VastaFlow backup [${LEVEL}] $(hostname | cut -c1-40): ${MSG}"

STATE_DIR="${BACKUP_ALERT_STATE_DIR:-${BACKUP_DIR:-/var/backups/vastaflow}/.alertas}"
mkdir -p "$STATE_DIR" 2>/dev/null || true
if [ "$QUIET_FOR" -gt 0 ] && [ -f "$STATE_DIR/ultimo" ]; then
  last="$(cat "$STATE_DIR/ultimo" 2>/dev/null || echo 0)"
  if [ $(( $(date +%s) - ${last:-0} )) -lt "$QUIET_FOR" ]; then exit 0; fi
fi

# Escapa para um valor entre aspas do arquivo de configuracao do curl.
cq() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

PROTO="=https"; [ "${BACKUP_ALERT_TEST_INSECURE:-0}" = "1" ] && PROTO="=http,https"
sent=0

if [ -n "${BACKUP_ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${BACKUP_ALERT_TELEGRAM_CHAT_ID:-}" ]; then
  if [[ "$BACKUP_ALERT_TELEGRAM_BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{20,}$ ]] && [[ "$BACKUP_ALERT_TELEGRAM_CHAT_ID" =~ ^-?[0-9]{5,20}$ ]]; then
    API="${BACKUP_ALERT_TELEGRAM_API:-https://api.telegram.org}"
    {
      printf 'url = "%s/bot%s/sendMessage"\n' "$(cq "$API")" "$(cq "$BACKUP_ALERT_TELEGRAM_BOT_TOKEN")"
      printf 'data-urlencode = "chat_id=%s"\n' "$(cq "$BACKUP_ALERT_TELEGRAM_CHAT_ID")"
      printf 'data-urlencode = "text=%s"\n' "$(cq "$TEXT")"
    } | curl -sS --fail --max-time 15 --proto "$PROTO" --max-redirs 0 -o /dev/null -K - 2>/dev/null && sent=1
  else
    echo "AVISO: BACKUP_ALERT_TELEGRAM_* com formato inesperado (ignorado)." >&2
  fi
fi

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ] && [ "$LEVEL" != "AVISO" ]; then
  URL="${BACKUP_HEARTBEAT_URL%/}"; [ "$LEVEL" = "FALHA" ] && URL="${URL}/fail"
  if printf 'url = "%s"\n' "$(cq "$URL")" | curl -sS --fail --max-time 15 --proto "$PROTO" --max-redirs 0 -o /dev/null -K - 2>/dev/null; then sent=1; fi
fi

if [ "$sent" -eq 1 ]; then date +%s > "$STATE_DIR/ultimo" 2>/dev/null || true; echo "alerta enviado ($LEVEL)"
else echo "AVISO: alerta NAO enviado (canal nao configurado ou indisponivel)." >&2; fi
exit 0
