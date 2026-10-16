#!/usr/bin/env bash
# ===========================================================================
# VastaFlow - prova LOCAL do desafio ACME HTTP-01 com um servidor ACME de teste (Pebble, do proprio
# Let's Encrypt). Nao usa o Let's Encrypt real, nao usa DNS publico e nao precisa de dominio.
# ---------------------------------------------------------------------------
# Sobe, numa rede descartavel sem portas no host: Pebble (a "CA"), pebble-challtestsrv (um DNS falso que
# aponta vastaflow.duckdns.org para o nosso nginx), o nginx em modo HTTPS (modelo real, com o certificado
# TEMPORARIO que o https-init.sh cria) e o certbot (os MESMOS argumentos do https-init.sh).
# O Pebble valida o dominio de verdade: conecta em http://<dominio>:80/.well-known/acme-challenge/<token>.
# Prova: o desafio e atendido pelo nginx, o certificado emitido substitui o temporario, o nginx o serve apos
# o reload, e o comando de renovacao do Compose funciona. Prova o NEGATIVO: sem DNS apontando, nao emite.
# NAO prova: o Let's Encrypt real (limites de taxa, politica), nem DNS/portas reais da VPS.
#   bash infra/https/test-acme.sh      (exit 0 = tudo passou)
# ===========================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."

P="vf-acme-test"; NET="${P}-net"
DOMAIN="${DOMAIN:-vastaflow.duckdns.org}"
NGINX_IMAGE="nginx:1.30.5-alpine"
CERTBOT_IMAGE="certbot/certbot:v4.2.0"
PEBBLE_IMAGE="ghcr.io/letsencrypt/pebble:latest"
CHALL_IMAGE="ghcr.io/letsencrypt/pebble-challtestsrv:latest"
PASS=0; FAIL=0

cleanup() {
  docker rm -f "${P}-pebble" "${P}-chall" "${P}-nginx" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "${P}-certs" "${P}-webroot" "${P}-html" "${P}-ca" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

ok()  { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FALHA- $1  [$2]"; }
check()  { if printf '%s' "$3" | grep -qiE -- "$2"; then ok "$1"; else bad "$1" "esperado /$2/, obtido: $(printf '%s' "$3" | head -c 200 | tr '\n' ' ')"; fi; }
refute() { if printf '%s' "$3" | grep -qiE -- "$2"; then bad "$1" "apareceu /$2/"; else ok "$1"; fi; }

echo "Preparando..."
docker network create "$NET" >/dev/null
for v in certs webroot html ca; do docker volume create "${P}-${v}" >/dev/null; done
for i in "$NGINX_IMAGE" "$CERTBOT_IMAGE" "$PEBBLE_IMAGE" "$CHALL_IMAGE" alpine:3.20 curlimages/curl:8.10.1; do docker pull -q "$i" >/dev/null; done

# Certificado TEMPORARIO, exatamente como scripts/https-init.sh o cria.
docker run --rm -v "${P}-certs:/etc/letsencrypt" -v "${P}-html:/html" alpine:3.20 sh -c "
  apk add --no-cache openssl >/dev/null &&
  mkdir -p /etc/letsencrypt/live/${DOMAIN} &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj '/CN=${DOMAIN}' \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem 2>/dev/null &&
  touch /etc/letsencrypt/live/${DOMAIN}/.vastaflow-temporario && echo '<html>spa</html>' > /html/index.html"

docker run -d --name "${P}-chall" --network "$NET" "$CHALL_IMAGE" -http01 "" -https01 "" -tlsalpn01 "" -doh "" -defaultIPv6 "" -defaultIPv4 "" >/dev/null
docker run -d --name "${P}-pebble" --network "$NET" --network-alias pebble -e PEBBLE_VA_NOSLEEP=1 \
  -v "$PWD/infra/https/pebble-config.json:/cfg/pebble-config.json:ro" \
  "$PEBBLE_IMAGE" -config /cfg/pebble-config.json -dnsserver "${P}-chall:8053" >/dev/null

CONF=(-v "$PWD/frontend/nginx/conf.d/00-rate-limit.conf:/etc/nginx/conf.d/00-rate-limit.conf:ro"
      -v "$PWD/frontend/nginx/conf.d/01-log-format.conf:/etc/nginx/conf.d/01-log-format.conf:ro"
      -v "$PWD/frontend/nginx/conf.d/02-hsts.conf:/etc/nginx/conf.d/02-hsts.conf:ro"
      -v "$PWD/frontend/nginx/snippets:/etc/nginx/snippets:ro" -v "${P}-html:/usr/share/nginx/html:ro")
docker run -d --name "${P}-nginx" --network "$NET" "${CONF[@]}" \
  -v "$PWD/infra/https/vastaflow-https.conf.template:/etc/nginx/templates/10-https.conf.template:ro" \
  -v "$PWD/infra/https/vastaflow-http-disabled.conf:/etc/nginx/conf.d/vastaflow.conf:ro" \
  -v "${P}-certs:/etc/letsencrypt:ro" -v "${P}-webroot:/var/www/certbot:ro" \
  -e "SERVER_NAME=${DOMAIN}" -e 'NGINX_ENVSUBST_FILTER=^SERVER_NAME$' -e 'NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d' \
  "$NGINX_IMAGE" sh -c "rm -f /etc/nginx/conf.d/default.conf; exec /docker-entrypoint.sh nginx -g 'daemon off;'" >/dev/null
sleep 4

NGINX_IP="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "${P}-nginx")"
curlc() { docker run --rm --network "$NET" curlimages/curl:8.10.1 -s --max-time 10 "$@"; }
# DNS FALSO: so ${DOMAIN} aponta para o nginx. O dominio "sem-dns-..." nao tem registro.
curlc -X POST -d "{\"host\":\"${DOMAIN}\",\"addresses\":[\"${NGINX_IP}\"]}" "http://${P}-chall:8055/add-a" >/dev/null
id="$(docker create "$PEBBLE_IMAGE")"
# A CA de teste do Pebble vai para um volume (sem arquivo no host: caminhos do host variam entre Linux e Windows).
docker cp "$id:/test/certs/pebble.minica.pem" - | tar -xO | docker run -i --rm -v "${P}-ca:/ca" alpine:3.20 sh -c 'cat > /ca/pebble.pem'
docker rm "$id" >/dev/null

certbot_run() { # webroot compartilhado; a CA de teste so e confiada dentro deste container
  docker run --rm --network "$NET" -v "${P}-certs:/etc/letsencrypt" -v "${P}-webroot:/var/www/certbot" \
    -v "${P}-ca:/ca:ro" -e REQUESTS_CA_BUNDLE=/ca/pebble.pem "$CERTBOT_IMAGE" "$@"
}
issuer() {
  docker run --rm --network "$NET" alpine:3.20 sh -c "apk add -q --no-cache openssl >/dev/null; echo | openssl s_client -connect ${NGINX_IP}:443 -servername ${DOMAIN} 2>/dev/null | openssl x509 -noout -issuer -serial"
}

echo; echo "== antes: nginx com o certificado TEMPORARIO"
BEFORE="$(issuer)"
check "nginx serve o certificado temporario (emissor = o proprio dominio)" "CN *= *${DOMAIN}" "$BEFORE"
docker run --rm -v "${P}-webroot:/w" alpine:3.20 sh -c 'mkdir -p /w/.well-known/acme-challenge && echo ok-acme > /w/.well-known/acme-challenge/probe'
check "o desafio ACME e atendido pela :80 (arquivo de prova do webroot)" "ok-acme" "$(curlc -H "Host: ${DOMAIN}" "http://${NGINX_IP}/.well-known/acme-challenge/probe")"

echo; echo "== NEGATIVO: dominio SEM registro no DNS nao emite certificado"
SEMDNS="sem-dns-$(date +%s).duckdns.org"
OUT="$(certbot_run certonly --webroot -w /var/www/certbot -d "$SEMDNS" --email teste@vastaflow.invalid --agree-tos --no-eff-email --non-interactive --server https://pebble:14000/dir 2>&1)"; RC=$?
if [ "$RC" -ne 0 ]; then ok "sem DNS apontando para a VPS o certbot FALHA (exit $RC)"; else bad "emitiu sem DNS" "rc=0"; fi
check "falha pelo motivo certo (nao conseguiu validar o dominio)" "(DNS problem|NXDOMAIN|unauthorized|Challenge failed|Some challenges have failed|Detail)" "$OUT"

echo; echo "== emissao com o DNS apontando e a :80 acessivel (mesmos argumentos do https-init.sh)"
# https-init.sh remove o certificado temporario antes do certbot (o nginx ja o carregou em memoria).
docker run --rm -v "${P}-certs:/etc/letsencrypt" alpine:3.20 sh -c "rm -rf /etc/letsencrypt/live/${DOMAIN} /etc/letsencrypt/archive/${DOMAIN} /etc/letsencrypt/renewal/${DOMAIN}.conf"
OUT="$(certbot_run certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email teste@vastaflow.invalid --agree-tos --no-eff-email --non-interactive --server https://pebble:14000/dir 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "certbot emitiu o certificado via HTTP-01 (exit 0)"; else bad "certbot falhou" "$(printf '%s' "$OUT" | tail -n 4 | tr '\n' ' ')"; fi
check "mensagem de sucesso do certbot" "Successfully received certificate" "$OUT"
LISTING="$(docker run --rm -v "${P}-certs:/etc/letsencrypt:ro" alpine:3.20 ls -A "/etc/letsencrypt/live/${DOMAIN}")"
check "fullchain.pem e privkey.pem existem no volume" "fullchain.pem" "$LISTING"
refute "o marcador do certificado temporario sumiu" "vastaflow-temporario" "$LISTING"
docker exec "${P}-nginx" nginx -s reload >/dev/null 2>&1
sleep 2
AFTER="$(issuer)"
check "apos o reload o nginx serve o certificado emitido pela CA de teste" "Pebble" "$AFTER"
if [ "$(printf '%s' "$AFTER" | grep serial)" != "$(printf '%s' "$BEFORE" | grep serial)" ]; then ok "o certificado servido mudou (serial diferente do temporario)"; else bad "serial igual ao do temporario" "-"; fi
check "o certificado cobre o dominio" "$DOMAIN" "$(docker run --rm --network "$NET" alpine:3.20 sh -c "apk add -q --no-cache openssl >/dev/null; echo | openssl s_client -connect ${NGINX_IP}:443 -servername ${DOMAIN} 2>/dev/null | openssl x509 -noout -ext subjectAltName")"

echo; echo "== renovacao (o comando do container certbot do docker-compose.https.yml)"
OUT="$(certbot_run renew --webroot -w /var/www/certbot 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "certbot renew termina com exit 0 (nada vencendo)"; else bad "certbot renew falhou" "$(printf '%s' "$OUT" | tail -n 3 | tr '\n' ' ')"; fi
check "informa que o certificado ainda nao precisa renovar" "(not yet due for renewal|no renewals were attempted)" "$OUT"
OUT="$(certbot_run renew --webroot -w /var/www/certbot --force-renewal 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then ok "renovacao FORCADA funciona pelo mesmo caminho HTTP-01 (exit 0)"; else bad "renovacao forcada falhou" "$(printf '%s' "$OUT" | tail -n 3 | tr '\n' ' ')"; fi
docker exec "${P}-nginx" nginx -s reload >/dev/null 2>&1; sleep 2
NEW="$(issuer)"
if [ "$(printf '%s' "$NEW" | grep serial)" != "$(printf '%s' "$AFTER" | grep serial)" ]; then ok "apos renovar + reload o nginx serve o certificado NOVO (serial mudou)"; else bad "serial nao mudou apos renovar" "-"; fi

echo; echo "Resultado: ${PASS} ok, ${FAIL} falha(s)"
[ "$FAIL" -eq 0 ]
