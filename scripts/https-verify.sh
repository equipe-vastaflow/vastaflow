#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - verificacao de ponta a ponta do HTTPS publico (rode na VPS ou de fora dela, depois do deploy).
# ---------------------------------------------------------------------------
#   SERVER_NAME=vastaflow.duckdns.org bash scripts/https-verify.sh
#   VERIFY_INSECURE=1 ...        aceita certificado nao confiavel (ensaio STAGING/autoassinado)
#   VERIFY_RESOLVE_IP=<ip> ...   ignora o DNS e fala com esse IP (testes locais)
#
# Confere: redirecionamento HTTP->HTTPS, certificado (emissor e validade), HSTS, bloqueios publicos e que o
# webhook do WhatsApp responde 403/404 a pedidos SEM assinatura valida (nunca 2xx). Imprime a URL do webhook
# para colar no painel da Meta - NAO faz nenhuma chamada a Meta e NAO envia mensagem.
# Nao imprime segredo algum. Exit 0 = tudo certo.
# ===========================================================================
set -uo pipefail

cd "$(dirname "$0")/.."
if [ -z "${SERVER_NAME:-}" ] && [ -f .env ]; then
  SERVER_NAME="$(grep -E '^SERVER_NAME=' .env | head -n1 | cut -d= -f2- || true)"
fi
: "${SERVER_NAME:?defina SERVER_NAME (dominio) no .env ou no ambiente}"
[[ "$SERVER_NAME" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || { echo "ERRO: SERVER_NAME invalido." >&2; exit 2; }

CURL=(curl -s --max-time 15)
[ "${VERIFY_INSECURE:-0}" = "1" ] && CURL+=(-k)
RESOLVE=()
if [ -n "${VERIFY_RESOLVE_IP:-}" ]; then
  RESOLVE=(--resolve "${SERVER_NAME}:443:${VERIFY_RESOLVE_IP}" --resolve "${SERVER_NAME}:80:${VERIFY_RESOLVE_IP}")
fi
req() { "${CURL[@]}" "${RESOLVE[@]}" "$@"; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FALHA- $1"; }

WEBHOOK_URL="https://${SERVER_NAME}/api/webhooks/whatsapp"
echo "URL publica do webhook do WhatsApp: ${WEBHOOK_URL}"
case "$WEBHOOK_URL" in https://*) ok "a URL do webhook usa HTTPS" ;; *) bad "a URL do webhook NAO usa HTTPS" ;; esac

echo "DNS e redirecionamento"
if [ -z "${VERIFY_RESOLVE_IP:-}" ]; then
  RESOLVED="$(getent ahostsv4 "$SERVER_NAME" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  if [ -n "${RESOLVED// /}" ]; then ok "DNS resolve: ${RESOLVED}"; else bad "DNS nao resolve ${SERVER_NAME}"; fi
fi
LOC="$(req -o /dev/null -w '%{http_code} %{redirect_url}' "http://${SERVER_NAME}/")"
case "$LOC" in "301 https://${SERVER_NAME}/") ok "HTTP -> 301 para HTTPS" ;; *) bad "HTTP nao redireciona para HTTPS (obtido: ${LOC})" ;; esac

echo "Certificado e cabecalhos"
HDR="$(req -D - -o /dev/null "https://${SERVER_NAME}/")"
if [ -n "$HDR" ]; then ok "HTTPS responde"; else bad "HTTPS nao responde (porta 443, certificado ou DNS)"; fi
grep -qi '^strict-transport-security: max-age=' <<<"$HDR" && ok "HSTS presente" || bad "HSTS ausente"
grep -qi "^content-security-policy:" <<<"$HDR" && ok "CSP presente" || bad "CSP ausente"
if command -v openssl >/dev/null; then
  TARGET="${VERIFY_RESOLVE_IP:-$SERVER_NAME}"
  CERT="$(echo | openssl s_client -connect "${TARGET}:443" -servername "$SERVER_NAME" 2>/dev/null | openssl x509 -noout -issuer -enddate -ext subjectAltName 2>/dev/null || true)"
  if grep -qi "$SERVER_NAME" <<<"$CERT"; then ok "certificado cobre ${SERVER_NAME}"; else bad "certificado nao cobre ${SERVER_NAME}"; fi
  echo "     $(grep -i '^issuer=' <<<"$CERT" | head -n1 | cut -c1-120)"
  echo "     $(grep -i '^notAfter=' <<<"$CERT" | head -n1)"
fi
if [ "${VERIFY_INSECURE:-0}" != "1" ]; then
  [ "$("${CURL[@]}" "${RESOLVE[@]}" -o /dev/null -w '%{ssl_verify_result}' "https://${SERVER_NAME}/")" = "0" ] \
    && ok "certificado CONFIAVEL (cadeia valida)" || bad "certificado NAO confiavel (staging, autoassinado ou expirado)"
fi

echo "Superficie publica"
code() { req -o /dev/null -w '%{http_code}' "$@"; }
[ "$(code "https://${SERVER_NAME}/api/service/identity")" = "404" ] && ok "/api/service* -> 404" || bad "/api/service* acessivel"
[ "$(code "https://${SERVER_NAME}/api/health/readiness")" = "403" ] && ok "/api/health/readiness -> 403" || bad "readiness acessivel"

echo "Webhook do WhatsApp (SEM assinatura valida nunca pode ser aceito)"
POST="$(code -X POST -H 'content-type: application/json' --data '{"object":"whatsapp_business_account"}' "$WEBHOOK_URL")"
case "$POST" in 403|404) ok "POST sem assinatura -> ${POST} (403 = assinatura exigida; 404 = WhatsApp desligado)" ;; *) bad "POST sem assinatura retornou ${POST}" ;; esac
BADSIG="$(code -X POST -H 'content-type: application/json' -H 'X-Hub-Signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000' --data '{"object":"whatsapp_business_account"}' "$WEBHOOK_URL")"
case "$BADSIG" in 403|404) ok "POST com assinatura invalida -> ${BADSIG}" ;; *) bad "POST com assinatura invalida retornou ${BADSIG}" ;; esac
GETV="$(code "${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=token-incorreto-de-teste&hub.challenge=123")"
case "$GETV" in 403|404) ok "verificacao (GET) com token incorreto -> ${GETV}" ;; *) bad "verificacao com token incorreto retornou ${GETV}" ;; esac

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ]
