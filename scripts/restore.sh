#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - restauracao de um backup gerado por scripts/backup.sh.
# ---------------------------------------------------------------------------
#   VF_RESTORE_CONFIRM=restaurar-em-<projeto> ./scripts/restore.sh <pasta-do-backup>
#
# Precisa da chave PRIVADA no chaveiro do gpg de quem executa (ela NAO fica no servidor de producao).
#
# SEGURANCA (esta ferramenta pode destruir dados se mal usada, por isso e teimosa):
#   - restaura numa stack ALVO escolhida por VF_COMPOSE (Compose + projeto); o alvo precisa ser
#     CONFIRMADO por nome (VF_RESTORE_CONFIRM=restaurar-em-<projeto do alvo>);
#   - recusa o projeto de producao ("vastaflow") a menos que VF_RESTORE_ALLOW_PRODUCTION=SOBRESCREVER-PRODUCAO;
#   - recusa banco/volumes que ja tenham dados, a menos que VF_RESTORE_FORCE=1;
#   - a CONFIGURACAO (.env, TLS, credenciais de servico) NUNCA e gravada por cima da existente: vai para
#     VF_CONFIG_OUT (pasta nova, modo 700) e o operador a copia conscientemente.
# Variaveis: VF_COMPOSE, VF_DOCUMENTS_VOLUME, VF_N8N_STATE_VOLUME, VF_HELPER_IMAGE (como no backup).
# ===========================================================================
set -euo pipefail
umask 077
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

SRC="${1:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "uso: VF_RESTORE_CONFIRM=restaurar-em-<projeto> $0 <pasta-do-backup>" >&2; exit 2; }
SRC="$(cd "$SRC" && pwd)"

DOCS_VOLUME="${VF_DOCUMENTS_VOLUME:-vastaflow-documents}"
N8N_VOLUME="${VF_N8N_STATE_VOLUME:-vastaflow-n8n-state}"
HELPER_IMAGE="${VF_HELPER_IMAGE:-alpine:3.20}"
read -r -a COMPOSE <<<"${VF_COMPOSE:-docker compose -f docker-compose.production.yml}"
CONFIG_OUT="${VF_CONFIG_OUT:-./restaurado-config-$(date -u +%Y%m%dT%H%M%SZ)}"

# --- 1. integridade -------------------------------------------------------
echo "[1/6] Conferindo hashes (SHA256SUMS)..."
(cd "$SRC" && sha256sum -c SHA256SUMS --quiet) || { echo "ERRO: backup corrompido ou adulterado; nada foi restaurado." >&2; exit 3; }

# --- 2. alvo confirmado ---------------------------------------------------
PROJECT="$("${COMPOSE[@]}" config --format json | grep -m1 -o '"name": *"[^"]*"' | cut -d'"' -f4)"
[ -n "$PROJECT" ] || { echo "ERRO: nao consegui determinar o projeto alvo." >&2; exit 2; }
if [ "${VF_RESTORE_CONFIRM:-}" != "restaurar-em-${PROJECT}" ]; then
  echo "ERRO: o alvo e o projeto '${PROJECT}'. Para confirmar: VF_RESTORE_CONFIRM=restaurar-em-${PROJECT}" >&2
  exit 2
fi
if [ "$PROJECT" = "vastaflow" ] && [ "${VF_RESTORE_ALLOW_PRODUCTION:-}" != "SOBRESCREVER-PRODUCAO" ]; then
  echo "ERRO: '${PROJECT}' e a producao. Restaurar sobre ela exige VF_RESTORE_ALLOW_PRODUCTION=SOBRESCREVER-PRODUCAO." >&2
  exit 2
fi
echo "      alvo confirmado: ${PROJECT}"

# --- 3. alvo vazio --------------------------------------------------------
TABLES="$("${COMPOSE[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\"$MYSQL_DATABASE\""' | tr -d '\r')"
if [ "$TABLES" != "0" ] && [ "${VF_RESTORE_FORCE:-0}" != "1" ]; then
  echo "ERRO: o MySQL alvo ja tem ${TABLES} tabelas. Recusado (use VF_RESTORE_FORCE=1 so se for intencional)." >&2
  exit 2
fi
volume_is_empty() { # 0 = vazio ou inexistente
  ! docker volume inspect "$1" >/dev/null 2>&1 && return 0
  [ -z "$(docker run --rm -v "$1:/data:ro" "$HELPER_IMAGE" ls -A /data)" ]
}
for vol in "$DOCS_VOLUME" "$N8N_VOLUME"; do
  if [ -f "$SRC/$( [ "$vol" = "$DOCS_VOLUME" ] && echo documents || echo n8n-state ).tar.gz.gpg" ] && ! volume_is_empty "$vol" && [ "${VF_RESTORE_FORCE:-0}" != "1" ]; then
    echo "ERRO: o volume ${vol} ja tem arquivos. Recusado (VF_RESTORE_FORCE=1 so se for intencional)." >&2
    exit 2
  fi
done

decrypt() { gpg --batch --yes --quiet --decrypt "$1"; }

# --- 4. bancos ------------------------------------------------------------
echo "[2/6] MySQL..."
decrypt "$SRC/mysql.sql.gz.gpg" | gunzip \
  | "${COMPOSE[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'

echo "[3/6] PostgreSQL do n8n..."
decrypt "$SRC/n8n-postgres.pgdump.gpg" \
  | "${COMPOSE[@]}" exec -T n8n-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges'

# --- 5. volumes -----------------------------------------------------------
restore_volume() { # arquivo, volume, descricao
  if [ -f "$1" ]; then
    docker volume create "$2" >/dev/null
    decrypt "$1" | gunzip | docker run --rm -i -v "$2:/data" "$HELPER_IMAGE" tar -C /data -xf -
    echo "      ${3} restaurado em ${2}"
  else
    echo "      (backup sem ${3}: ignorado)"
  fi
}
echo "[4/6] Documentos privados..."
restore_volume "$SRC/documents.tar.gz.gpg" "$DOCS_VOLUME" "documentos"
echo "[5/6] Estado do n8n..."
restore_volume "$SRC/n8n-state.tar.gz.gpg" "$N8N_VOLUME" "estado do n8n"

# --- 6. configuracao (nunca por cima) --------------------------------------
echo "[6/6] Configuracao -> ${CONFIG_OUT} (voce copia, conscientemente, o que precisar)..."
[ ! -e "$CONFIG_OUT" ] || { echo "ERRO: ${CONFIG_OUT} ja existe." >&2; exit 2; }
mkdir -p "$CONFIG_OUT"; chmod 700 "$CONFIG_OUT"
decrypt "$SRC/config.tar.gz.gpg" | gunzip | tar -C "$CONFIG_OUT" -xf -

echo "RESTAURACAO CONCLUIDA no projeto '${PROJECT}'. Verificacao rapida:"
"${COMPOSE[@]}" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "SELECT CONCAT(\"mysql: \", COUNT(*), \" tabelas\") FROM information_schema.tables WHERE table_schema=\"$MYSQL_DATABASE\""' | tr -d '\r'
"${COMPOSE[@]}" exec -T n8n-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT '"'"'postgres: '"'"' || COUNT(*) || '"'"' tabelas'"'"' FROM information_schema.tables WHERE table_schema='"'"'public'"'"'"' | tr -d '\r'
echo "Proximo passo: subir o backend/n8n apontando para estes dados e conferir (docs/backup-restauracao.md)."
