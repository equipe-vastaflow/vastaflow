#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - funcoes da COPIA EXTERNA do backup (rclone). Nao e executavel: e carregada ("source") por
# scripts/backup.sh, backup-watchdog.sh, backup-fetch.sh e pelos testes (infra/backup/test-remote.sh).
# ---------------------------------------------------------------------------
# O que sobe para o destino e SEMPRE um diretorio de backup JA CIFRADO com gpg (chave publica): o provedor
# (Google Drive, S3...) nunca ve texto em claro. Esta biblioteca cuida de: checar espaco antes, enviar,
# conferir (rclone check), repetir envios pendentes e podar com retencao por faixas + orcamento de bytes.
#
# Variaveis (todas opcionais, valores padrao abaixo):
#   BACKUP_REMOTE                    destino rclone "remoto:pasta" (ex.: gdrive:vastaflow-backups). Vazio = sem copia externa
#   BACKUP_REMOTE_MAX_BYTES          orcamento total do destino para ESTES backups (padrao 8 GiB; Drive gratis = 15 GB compartilhados)
#   BACKUP_REMOTE_MIN_FREE_BYTES     folga minima livre no destino depois do envio (padrao 1 GiB)
#   BACKUP_KEEP_DAILY/WEEKLY/MONTHLY retencao: 7 diarios + 4 semanais + 3 mensais (o mais recente de cada periodo)
#   BACKUP_KEEP_MIN                  nunca deixar menos que isto (padrao 3)
# Regras de seguranca: NUNCA usa `rclone cleanup` (no Drive esvazia a lixeira da conta INTEIRA); remocoes usam
# --drive-use-trash=false (sem isso o arquivo vai para a lixeira e CONTINUA ocupando a cota de 15 GB);
# so poda DEPOIS de o envio novo ser conferido; nunca apaga o backup recem-enviado.
# ===========================================================================

BACKUP_REMOTE_MAX_BYTES="${BACKUP_REMOTE_MAX_BYTES:-8589934592}"
BACKUP_REMOTE_MIN_FREE_BYTES="${BACKUP_REMOTE_MIN_FREE_BYTES:-1073741824}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
BACKUP_KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-3}"
BACKUP_KEEP_MIN="${BACKUP_KEEP_MIN:-3}"
STAMP_PATTERN='^20[0-9]{6}T[0-9]{6}Z$'

# rclone com tentativas e prazos; `env -u MSYS_NO_PATHCONV` deixa o Git Bash (Windows) converter caminhos para o
# rclone.exe nativo (no Linux nao muda nada).
rc() { env -u MSYS_NO_PATHCONV rclone --retries 3 --low-level-retries 10 --contimeout 30s --timeout 2m --stats 0 -q "$@"; }

remote_name() { printf '%s:' "${BACKUP_REMOTE%%:*}"; }

# Inteiro do campo JSON ("free":123) ou vazio. Sem jq: o JSON do rclone e simples.
json_int() { grep -o "\"$1\": *[0-9]*" | head -n1 | grep -o '[0-9]*$' || true; }

remote_free_bytes()  { rc about "$(remote_name)" --json 2>/dev/null | json_int free; }
remote_used_bytes()  { local out; out="$(rc size "$BACKUP_REMOTE" --json 2>/dev/null)" || { echo 0; return 0; }; json_int bytes <<<"$out"; }
dir_bytes()          { local t=0 f; while IFS= read -r f; do t=$((t + $(wc -c <"$f" | tr -d ' '))); done < <(find "$1" -type f); echo "$t"; }

# Lista os carimbos (diretorios de backup) existentes no destino, do mais novo para o mais antigo.
# Retorno != 0 se NAO conseguiu listar (quem chama NAO deve apagar nada nesse caso).
remote_list_stamps() {
  local out
  out="$(rc lsf "$BACKUP_REMOTE" --dirs-only 2>/dev/null)" || return 1
  printf '%s\n' "$out" | sed 's#/$##' | grep -E "$STAMP_PATTERN" | sort -r || true
}

# Checagem ANTES de enviar: alcanca o destino? ha espaco para $1 bytes + folga? o orcamento comporta?
# Define REMOTE_PROBLEM (codigo curto, sem dado sensivel) e devolve 0 (ok), 10 (inalcancavel), 11 (sem espaco),
# 12 (backup maior que o orcamento).
preflight_remote() {
  local needed="$1" free
  REMOTE_PROBLEM=""
  if ! rc mkdir "$BACKUP_REMOTE" >/dev/null 2>&1; then REMOTE_PROBLEM="destino_inalcancavel"; return 10; fi
  free="$(remote_free_bytes)"
  if [ -z "$free" ]; then
    REMOTE_NOTE="espaco_livre_desconhecido"        # ex.: conta com cota ilimitada; segue so com o orcamento
  elif [ "$free" -lt $((needed + BACKUP_REMOTE_MIN_FREE_BYTES)) ]; then
    REMOTE_PROBLEM="sem_espaco_no_destino"; return 11
  fi
  if [ "$needed" -gt "$BACKUP_REMOTE_MAX_BYTES" ]; then REMOTE_PROBLEM="backup_maior_que_o_orcamento"; return 12; fi
  return 0
}

# Envia o diretorio de backup $1 e CONFERE (hash) depois. 0 = ok. Nao apaga nada.
upload_snapshot() {
  local dir="$1" name; name="$(basename "$dir")"
  rc copy "$dir" "$BACKUP_REMOTE/$name" >/dev/null 2>&1 || return 1
  rc check "$dir" "$BACKUP_REMOTE/$name" --one-way >/dev/null 2>&1 || return 2
}

pending_marker() { printf '%s/%s.upload-pendente' "$BACKUP_DIR" "$1"; }

# Reenvia backups locais cujo envio falhou antes (marcador `<carimbo>.upload-pendente`), do mais antigo ao mais novo.
# Devolve 0 se nao ha pendencia ou todas foram enviadas; 1 se alguma continua pendente.
retry_pending_uploads() {
  local marker stamp rc_all=0 n=0
  while IFS= read -r marker; do
    stamp="$(basename "$marker" .upload-pendente)"
    [ -d "$BACKUP_DIR/$stamp" ] || { rm -f "$marker"; continue; }
    n=$((n + 1)); [ "$n" -le 5 ] || break
    if upload_snapshot "$BACKUP_DIR/$stamp"; then rm -f "$marker"; echo "      envio pendente de $stamp concluido"
    else rc_all=1; echo "      envio pendente de $stamp continua falhando" >&2; fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name '*.upload-pendente' -type f | sort)
  return "$rc_all"
}

# Funcao PURA: le carimbos (um por linha, qualquer ordem) e imprime os que DEVEM ser mantidos.
# Regra: o mais recente de cada um dos ultimos KEEP_DAILY dias, de cada uma das ultimas KEEP_WEEKLY semanas ISO
# e de cada um dos ultimos KEEP_MONTHLY meses. O mais recente de todos e sempre mantido.
select_keep() {
  local -a stamps; local -A keep seen_d seen_w seen_m
  local s day week month nd=0 nw=0 nm=0
  mapfile -t stamps < <(grep -E "$STAMP_PATTERN" | sort -r)
  for s in "${stamps[@]}"; do
    day="${s:0:4}-${s:4:2}-${s:6:2}"
    week="$(date -u -d "$day" +%G-%V)"
    month="${s:0:6}"
    if [ -z "${seen_d[${s:0:8}]:-}" ] && [ "$nd" -lt "$BACKUP_KEEP_DAILY" ]; then seen_d[${s:0:8}]=1; nd=$((nd + 1)); keep[$s]=1; fi
    if [ -z "${seen_w[$week]:-}" ] && [ "$nw" -lt "$BACKUP_KEEP_WEEKLY" ]; then seen_w[$week]=1; nw=$((nw + 1)); keep[$s]=1; fi
    if [ -z "${seen_m[$month]:-}" ] && [ "$nm" -lt "$BACKUP_KEEP_MONTHLY" ]; then seen_m[$month]=1; nm=$((nm + 1)); keep[$s]=1; fi
  done
  [ "${#stamps[@]}" -gt 0 ] && keep[${stamps[0]}]=1
  for s in "${stamps[@]}"; do [ -n "${keep[$s]:-}" ] && echo "$s"; done
  return 0
}

remove_remote_snapshot() { rc purge "$BACKUP_REMOTE/$1" --drive-use-trash=false >/dev/null 2>&1; }

# Poda o destino: (1) retencao por faixas; (2) orcamento de bytes (apaga os mais antigos que sobraram, ate caber).
# $1 = carimbo recem-enviado (INTOCAVEL). Imprime o que removeu. REMOTE_PRUNE_NOTE = "orcamento" se (2) agiu.
prune_remote() {
  local just="$1" listed keep s total size
  REMOTE_PRUNE_NOTE=""
  listed="$(remote_list_stamps)" || { echo "      poda ignorada: nao consegui listar o destino" >&2; return 1; }
  [ -n "$listed" ] || return 0
  keep="$(select_keep <<<"$listed")"
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    [ "$s" = "$just" ] && continue
    if ! grep -qx "$s" <<<"$keep"; then
      if remove_remote_snapshot "$s"; then echo "      destino: removido $s (fora da retencao)"; else echo "      destino: NAO consegui remover $s" >&2; fi
    fi
  done <<<"$listed"
  # Orcamento: soma o que ficou e remove do mais antigo ao mais novo, preservando KEEP_MIN e o recem-enviado.
  total="$(remote_used_bytes)"
  total="${total:-0}"
  if [ "$total" -gt "$BACKUP_REMOTE_MAX_BYTES" ]; then
    local -a left; mapfile -t left < <(remote_list_stamps | sort)   # mais antigo primeiro
    for s in "${left[@]}"; do
      [ "$total" -le "$BACKUP_REMOTE_MAX_BYTES" ] && break
      [ "${#left[@]}" -gt "$BACKUP_KEEP_MIN" ] || break
      [ "$s" = "$just" ] && continue
      size="$(rc size "$BACKUP_REMOTE/$s" --json 2>/dev/null | json_int bytes)"; size="${size:-0}"
      if remove_remote_snapshot "$s"; then
        total=$((total - size)); REMOTE_PRUNE_NOTE="orcamento"; echo "      destino: removido $s (orcamento de bytes)"
        mapfile -t left < <(remote_list_stamps | sort)
      fi
    done
  fi
  return 0
}

# Carimbo mais recente no destino (vazio se nenhum / inalcancavel).
remote_latest_stamp() { remote_list_stamps 2>/dev/null | head -n1; }

# Idade em segundos de um carimbo 20261016T033000Z.
stamp_age_seconds() {
  local s="$1" t
  t="$(date -u -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}:${s:11:2}:${s:13:2}" +%s)" || return 1
  echo $(( $(date -u +%s) - t ))
}
