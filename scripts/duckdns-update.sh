#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - atualiza o registro A do subdominio gratuito DuckDNS (<nome>.duckdns.org).
# ---------------------------------------------------------------------------
# Rode NA VPS (agendado por infra/duckdns/vastaflow-duckdns.timer). Le /etc/vastaflow/duckdns.env
# (fora do Git, modo 600; modelo em infra/duckdns/duckdns.env.example):
#   DUCKDNS_DOMAIN=vastaflow       so o subdominio, sem ".duckdns.org"
#   DUCKDNS_TOKEN=<token da sua conta DuckDNS>   SEGREDO
#   DUCKDNS_IP=                    vazio = o DuckDNS usa o IP de origem da requisicao (a propria VPS)
#
# SEGURANCA
#   - O token NUNCA vai em argumento de linha de comando (apareceria em `ps`): a URL e entregue ao curl
#     por stdin (`curl -K -`). Nada do token e impresso; a saida e so OK/KO.
#   - Somente HTTPS (`--proto =https`). Sem redirecionamento. DUCKDNS_TEST_INSECURE=1 existe apenas para
#     os testes locais contra um servidor falso em loopback (infra/duckdns/test-duckdns.sh).
# O token e criado por voce na conta DuckDNS (nada neste projeto cria conta nem registra subdominio).
# ===========================================================================
set -euo pipefail
umask 077

ENV_FILE="${DUCKDNS_ENV_FILE:-/etc/vastaflow/duckdns.env}"
if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

: "${DUCKDNS_DOMAIN:?defina DUCKDNS_DOMAIN (so o subdominio) em ${ENV_FILE}}"
: "${DUCKDNS_TOKEN:?defina DUCKDNS_TOKEN em ${ENV_FILE}}"
API_URL="${DUCKDNS_API_URL:-https://www.duckdns.org/update}"

if ! [[ "$DUCKDNS_DOMAIN" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "ERRO: DUCKDNS_DOMAIN invalido: use so o subdominio (ex.: vastaflow), sem .duckdns.org." >&2; exit 2
fi
if ! [[ "$DUCKDNS_TOKEN" =~ ^[A-Za-z0-9-]{16,64}$ ]]; then
  echo "ERRO: DUCKDNS_TOKEN com formato inesperado." >&2; exit 2   # nao repete o valor
fi
if [ -n "${DUCKDNS_IP:-}" ] && ! [[ "$DUCKDNS_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "ERRO: DUCKDNS_IP deve ser um IPv4 (ou vazio)." >&2; exit 2
fi
PROTO="=https"
if [ "${DUCKDNS_TEST_INSECURE:-0}" = "1" ]; then
  PROTO="=http,https"
elif [[ "$API_URL" != https://* ]]; then
  echo "ERRO: DUCKDNS_API_URL precisa ser https." >&2; exit 2
fi

# `-K -` : opcoes (e a URL, com o token) pelo stdin, nao pelo argv.
RESPONSE="$(printf 'url = "%s?domains=%s&token=%s&ip=%s"\n' "$API_URL" "$DUCKDNS_DOMAIN" "$DUCKDNS_TOKEN" "${DUCKDNS_IP:-}" \
  | curl -sS --fail --max-time 20 --proto "$PROTO" --max-redirs 0 -K - 2>/dev/null || true)"

case "$RESPONSE" in
  OK*) echo "DuckDNS: OK (${DUCKDNS_DOMAIN}.duckdns.org atualizado)" ;;
  KO*) echo "DuckDNS: KO - recusado (token ou subdominio incorretos)." >&2; exit 1 ;;
  *)   echo "DuckDNS: sem resposta valida (rede ou servico indisponivel)." >&2; exit 1 ;;
esac
